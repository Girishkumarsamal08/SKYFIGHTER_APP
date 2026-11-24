"""
SKYFIGHTER DRONE VISION — YOLO INFERENCE ENGINE
Multi-class detection engine with temporal confirmation filter and alert cooldown.
Classes: Person, Animal (Bird, Dog, Cat, Cow, Elephant, Bear, etc.), Fire, Smoke.
"""

import time
import threading
from typing import List, Dict, Any, Optional
from pathlib import Path
import cv2
import numpy as np
from ultralytics import YOLO

from ai_pipeline.service.config import settings

# Supported Animal COCO class indices mapped to display labels
COCO_ANIMAL_MAP = {
    14: "Bird",
    15: "Cat",
    16: "Dog",
    17: "Horse",
    18: "Sheep",
    19: "Cow",
    20: "Elephant",
    21: "Bear",
    22: "Zebra",
    23: "Giraffe"
}

def get_threat_assessment(species_or_class: str) -> Dict[str, str]:
    """Evaluates danger category, reasons, and safety actions for detected species."""
    species = species_or_class.capitalize() if species_or_class else "Unknown"
    matrix = {
        "Tiger": {
            "threat_category": "CRITICAL",
            "threat_reason": "Apex predator - immediate threat to human life & livestock",
            "action": "Maintain high altitude (>50m), alert rangers and ground team immediately"
        },
        "Leopard": {
            "threat_category": "CRITICAL",
            "threat_reason": "Stalking predator - severe risk to field personnel",
            "action": "Alert ground team immediately, maintain continuous optical tracking"
        },
        "Elephant": {
            "threat_category": "HIGH",
            "threat_reason": "Massive megafauna - prone to charging when agitated",
            "action": "Maintain standoff distance (>50m AGL), observe herd direction"
        },
        "Bear": {
            "threat_category": "HIGH",
            "threat_reason": "Aggressive territorial mammal - severe attack risk if startled",
            "action": "Sound dissuasion alert, maintain safe separation distance"
        },
        "Wild Boar": {
            "threat_category": "MODERATE",
            "threat_reason": "Aggressive tusk charging risk if cornered",
            "action": "Advise ground personnel to avoid dense scrub"
        },
        "Deer": {
            "threat_category": "LOW",
            "threat_reason": "Non-threatening herbivore, indicator of ecosystem activity",
            "action": "Routine observation, log GPS coordinates"
        },
        "Bird": {
            "threat_category": "LOW",
            "threat_reason": "Aerial wildlife - potential collision risk near rotors",
            "action": "Monitor airspace clear of rotors"
        },
        "Dog": {
            "threat_category": "MODERATE",
            "threat_reason": "Potential feral pack or companion animal",
            "action": "Check for nearby human settlements"
        },
        "Cat": {
            "threat_category": "LOW",
            "threat_reason": "Small domestic / wild cat",
            "action": "Routine observation"
        },
        "Cow": {
            "threat_category": "LOW",
            "threat_reason": "Livestock grazing in forest perimeter",
            "action": "Record encroachment zone"
        },
        "Horse": {
            "threat_category": "LOW",
            "threat_reason": "Domesticated / feral equine",
            "action": "Routine observation"
        },
        "Human": {
            "threat_category": "MODERATE",
            "threat_reason": "Ground personnel or unauthorized forest trespasser",
            "action": "Verify ranger credentials / alert perimeter security"
        },
        "Person": {
            "threat_category": "MODERATE",
            "threat_reason": "Ground personnel or unauthorized forest trespasser",
            "action": "Verify ranger credentials / alert perimeter security"
        },
        "Unknown Object": {
            "threat_category": "MODERATE",
            "threat_reason": "Low confidence or unclassified optical signature",
            "action": "Re-orient camera gimbal for clear line-of-sight"
        }
    }
    return matrix.get(species, {
        "threat_category": "LOW",
        "threat_reason": "Forest wildlife observed in patrol zone",
        "action": "Routine observation"
    })

# Tactical HUD Theme Colors (BGR)
COLOR_FIRE = (0, 0, 239)        # Vibrant Red (#ef4444)
COLOR_SMOKE = (11, 158, 245)     # Amber/Smoke (#f59e0b)
COLOR_PERSON = (94, 197, 34)     # Bright Tactical Green (#22c55e)
COLOR_ANIMAL = (255, 212, 0)     # Neon Cyan (#00d4ff)
COLOR_DEFAULT = (200, 200, 200)

class YOLOInferenceEngine:
    def __init__(self, camera_streamer):
        self.camera = camera_streamer
        self._lock = threading.Lock()
        self._running = False
        self._worker_thread: Optional[threading.Thread] = None

        # Models
        self.fire_smoke_model: Optional[YOLO] = None
        self.coco_model: Optional[YOLO] = None
        self._load_models()

        # Dynamic Thresholds
        self.conf_fire = settings.CONF_FIRE
        self.conf_smoke = settings.CONF_SMOKE
        self.conf_person = settings.CONF_PERSON
        self.conf_animal = settings.CONF_ANIMAL

        # Persistence & Alert Cooldown State
        self.persistence_threshold = settings.PERSISTENCE_THRESHOLD
        self.alert_cooldown_sec = settings.ALERT_COOLDOWN_SEC
        self.persistence_count = 0
        self.fire_alert_active = False
        self.last_alert_time: Dict[str, float] = {
            "Fire": 0.0,
            "Smoke": 0.0,
            "Person": 0.0,
            "Animal": 0.0
        }

        # Detections Snapshot
        self.latest_detections: List[Dict[str, Any]] = []
        self.latest_counts: Dict[str, int] = {
            "Person": 0,
            "Animal": 0,
            "Fire": 0,
            "Smoke": 0,
            "Total": 0
        }

        # Historical Event Log (Ring Buffer of max 150 events)
        self.event_history: List[Dict[str, Any]] = []
        self.max_history = 150
        self.event_counter = 0

        # Cumulative Metrics
        self.total_detections_cumulative = 0
        self.people_detected_cumulative = 0
        self.animals_detected_cumulative = 0
        self.fire_detections_cumulative = 0
        self.smoke_detections_cumulative = 0

    def _load_models(self):
        """Loads both specialized fire/smoke model and COCO model with fallback."""
        fire_path = Path(settings.FIRE_SMOKE_MODEL_PATH)
        if fire_path.exists():
            try:
                print(f"[YOLOEngine] Loading dedicated Fire/Smoke model from: {fire_path}")
                self.fire_smoke_model = YOLO(str(fire_path))
                print(f"[YOLOEngine] Fire/Smoke model classes: {self.fire_smoke_model.names}")
            except Exception as e:
                print(f"[YOLOEngine] Error loading fire/smoke weights: {e}")
                self.fire_smoke_model = None
        else:
            print(f"[YOLOEngine] Fire/Smoke model weights not found at {fire_path}. Will use COCO fallback.")

        coco_path = Path(settings.COCO_MODEL_PATH)
        if coco_path.exists():
            try:
                print(f"[YOLOEngine] Loading COCO wildlife/person model from: {coco_path}")
                self.coco_model = YOLO(str(coco_path))
            except Exception as e:
                print(f"[YOLOEngine] Error loading COCO weights: {e}")
                self.coco_model = None
        else:
            try:
                print("[YOLOEngine] Loading default yolov8n.pt...")
                self.coco_model = YOLO("yolov8n.pt")
            except Exception as e:
                print(f"[YOLOEngine] Could not load default yolov8n.pt: {e}")

    def start(self):
        if self._running:
            return
        self._running = True
        self._worker_thread = threading.Thread(target=self._inference_loop, daemon=True, name="YOLOInferenceWorker")
        self._worker_thread.start()
        print("[YOLOEngine] Inference worker thread started.")

    def stop(self):
        self._running = False
        if self._worker_thread and self._worker_thread.is_alive():
            self._worker_thread.join(timeout=2.0)
        print("[YOLOEngine] Inference worker thread stopped.")

    def update_config(self, conf_fire: Optional[float] = None, conf_smoke: Optional[float] = None,
                      conf_person: Optional[float] = None, conf_animal: Optional[float] = None,
                      persistence: Optional[int] = None, cooldown: Optional[float] = None):
        with self._lock:
            if conf_fire is not None: self.conf_fire = conf_fire
            if conf_smoke is not None: self.conf_smoke = conf_smoke
            if conf_person is not None: self.conf_person = conf_person
            if conf_animal is not None: self.conf_animal = conf_animal
            if persistence is not None: self.persistence_threshold = persistence
            if cooldown is not None: self.alert_cooldown_sec = cooldown
        print(f"[YOLOEngine] Thresholds updated: Fire={self.conf_fire}, Smoke={self.conf_smoke}, Person={self.conf_person}, Animal={self.conf_animal}")

    def clear_alerts(self):
        with self._lock:
            self.persistence_count = 0
            self.fire_alert_active = False
        print("[YOLOEngine] Fire alerts cleared by pilot.")

    def _inference_loop(self):
        """Asynchronous worker that continuously consumes the latest camera frame."""
        while self._running:
            frame, timestamp = self.camera.get_latest_frame()
            if frame is None or timestamp == 0:
                time.sleep(0.05)
                continue

            # Run detection on a copy of the frame
            detections = self._detect_frame(frame)
            self._process_detection_logic(detections, timestamp)

            # Throttle inference to prevent 100% CPU pinning
            time.sleep(0.02)

    def _detect_frame(self, frame: np.ndarray) -> List[Dict[str, Any]]:
        raw_detections = []
        now = time.time()

        # 1. Run Dedicated Fire & Smoke Model
        if self.fire_smoke_model:
            try:
                min_conf = min(self.conf_fire, self.conf_smoke)
                res = self.fire_smoke_model.predict(frame, conf=min_conf, verbose=False)
                if res and len(res) > 0 and res[0].boxes:
                    for box in res[0].boxes:
                        cls_id = int(box.cls[0].item())
                        conf = float(box.conf[0].item())
                        name = self.fire_smoke_model.names.get(cls_id, f"Class {cls_id}")
                        xyxy = box.xyxy[0].cpu().numpy().astype(int).tolist()

                        # Check threshold
                        if (name.lower() == "fire" and conf >= self.conf_fire) or \
                           (name.lower() == "smoke" and conf >= self.conf_smoke) or \
                           (name.lower() == "human" and conf >= self.conf_person) or \
                           (name.lower() == "animal" and conf >= self.conf_animal):
                            raw_detections.append({
                                "class": "Person" if name.lower() == "human" else name.capitalize(),
                                "species": None,
                                "category": "Fire" if name.lower() == "fire" else ("Smoke" if name.lower() == "smoke" else ("Person" if name.lower() == "human" else "Animal")),
                                "confidence": round(conf, 3),
                                "bbox": xyxy,
                                "model": "fine_tuned"
                            })
            except Exception as e:
                pass

        # 2. Run COCO Model for Person & Detailed Wildlife Species
        if self.coco_model:
            try:
                min_coco = min(self.conf_person, self.conf_animal)
                c_res = self.coco_model.predict(frame, conf=min_coco, verbose=False)
                if c_res and len(c_res) > 0 and c_res[0].boxes:
                    for box in c_res[0].boxes:
                        cls_id = int(box.cls[0].item())
                        conf = float(box.conf[0].item())
                        xyxy = box.xyxy[0].cpu().numpy().astype(int).tolist()

                        if cls_id == 0 and conf >= self.conf_person: # Person
                            t_info = get_threat_assessment("Human")
                            raw_detections.append({
                                "class": "Person",
                                "species": "Human",
                                "category": "Person",
                                "confidence": round(conf, 3),
                                "bbox": xyxy,
                                "model": "coco",
                                "threat_category": t_info["threat_category"],
                                "threat_reason": t_info["threat_reason"],
                                "action": t_info["action"],
                                "distance": "DISTANCE UNKNOWN"
                            })
                        elif cls_id in COCO_ANIMAL_MAP and conf >= self.conf_animal:
                            species_name = COCO_ANIMAL_MAP[cls_id]
                            t_info = get_threat_assessment(species_name)
                            raw_detections.append({
                                "class": species_name,
                                "species": species_name,
                                "category": "Animal",
                                "confidence": round(conf, 3),
                                "bbox": xyxy,
                                "model": "coco",
                                "threat_category": t_info["threat_category"],
                                "threat_reason": t_info["threat_reason"],
                                "action": t_info["action"],
                                "distance": "DISTANCE UNKNOWN"
                            })
            except Exception as e:
                pass

        # Deduplicate overlapping boxes
        return self._nms_deduplicate(raw_detections)

    def _nms_deduplicate(self, detections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Simple IOU-based deduplication prioritizing higher confidence detections."""
        if len(detections) <= 1:
            return detections

        detections = sorted(detections, key=lambda x: x["confidence"], reverse=True)
        keep = []

        for d in detections:
            overlap = False
            b1 = d["bbox"]
            for k in keep:
                b2 = k["bbox"]
                # Compute IOU
                x1 = max(b1[0], b2[0])
                y1 = max(b1[1], b2[1])
                x2 = min(b1[2], b2[2])
                y2 = min(b1[3], b2[3])
                w = max(0, x2 - x1)
                h = max(0, y2 - y1)
                inter = w * h
                area1 = (b1[2] - b1[0]) * (b1[3] - b1[1])
                area2 = (b2[2] - b2[0]) * (b2[3] - b2[1])
                union = area1 + area2 - inter
                iou = inter / union if union > 0 else 0

                if iou > 0.50 and d["category"] == k["category"]:
                    overlap = True
                    break
            if not overlap:
                keep.append(d)

        return keep

    def _process_detection_logic(self, detections: List[Dict[str, Any]], timestamp: float):
        now = time.time()
        has_fire = any(d["category"] == "Fire" for d in detections)
        has_smoke = any(d["category"] == "Smoke" for d in detections)

        counts = {"Person": 0, "Animal": 0, "Fire": 0, "Smoke": 0, "Total": len(detections)}
        for d in detections:
            cat = d["category"]
            if cat in counts:
                counts[cat] += 1

        with self._lock:
            # Temporal Persistence Logic for Fire & Smoke
            if has_fire or has_smoke:
                self.persistence_count = min(self.persistence_count + 1, self.persistence_threshold + 6)
            else:
                self.persistence_count = max(self.persistence_count - 1, 0)

            # Fire Lock Trigger
            if self.persistence_count >= self.persistence_threshold:
                self.fire_alert_active = True
            elif self.persistence_count == 0:
                self.fire_alert_active = False

            self.latest_detections = detections
            self.latest_counts = counts

            # Event logging with Cooldown Filtering
            for d in detections:
                cat = d["category"]
                last_time = self.last_alert_time.get(cat, 0.0)

                # Check if cooldown has expired for this category
                if (now - last_time) >= self.alert_cooldown_sec:
                    self.last_alert_time[cat] = now
                    self.event_counter += 1

                    # Cumulative updates
                    self.total_detections_cumulative += 1
                    if cat == "Person": self.people_detected_cumulative += 1
                    elif cat == "Animal": self.animals_detected_cumulative += 1
                    elif cat == "Fire": self.fire_detections_cumulative += 1
                    elif cat == "Smoke": self.smoke_detections_cumulative += 1

                    event_entry = {
                        "id": self.event_counter,
                        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(timestamp)),
                        "timestamp_raw": round(timestamp, 3),
                        "class_name": d["class"],
                        "category": cat,
                        "confidence": int(d["confidence"] * 100),
                        "bbox": d["bbox"],
                        "alert_severity": "CRITICAL" if cat in ["Fire", "Smoke"] else "INFO"
                    }
                    self.event_history.insert(0, event_entry)
                    if len(self.event_history) > self.max_history:
                        self.event_history.pop()

    def get_latest_snapshot(self) -> Dict[str, Any]:
        with self._lock:
            model_connected = (self.fire_smoke_model is not None) or (self.coco_model is not None)
            wildlife_assessments = []
            for d in self.latest_detections:
                if d.get("category") in ["Animal", "Person"]:
                    wildlife_assessments.append({
                        "species": d.get("species", d["class"]),
                        "confidence": int(d["confidence"] * 100),
                        "threat_category": d.get("threat_category", "LOW"),
                        "threat_reason": d.get("threat_reason", "Routine wildlife observation"),
                        "action": d.get("action", "Routine monitoring"),
                        "distance": "DISTANCE UNKNOWN",
                        "timestamp": time.strftime("%H:%M:%S")
                    })
            return {
                "model_connected": model_connected,
                "active_detections": self.latest_detections,
                "wildlife_assessments": wildlife_assessments,
                "counts": self.latest_counts,
                "persistence": self.persistence_count,
                "persistence_threshold": self.persistence_threshold,
                "fire_alert_active": self.fire_alert_active,
                "cumulative_statistics": {
                    "total": self.total_detections_cumulative,
                    "people": self.people_detected_cumulative,
                    "animals": self.animals_detected_cumulative,
                    "fire": self.fire_detections_cumulative,
                    "smoke": self.smoke_detections_cumulative
                }
            }

    def get_history(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self._lock:
            return self.event_history[:limit]

    def annotate_frame(self, frame: np.ndarray) -> np.ndarray:
        """Annotates frame with tactical bounding boxes, labels, and status bar."""
        with self._lock:
            detections = list(self.latest_detections)
            persistence = self.persistence_count
            p_thresh = self.persistence_threshold
            alert_active = self.fire_alert_active

        h, w = frame.shape[:2]

        # 1. Draw Bounding Boxes
        for d in detections:
            cat = d["category"]
            cname = d["class"]
            conf = d["confidence"]
            x1, y1, x2, y2 = d["bbox"]

            if cat == "Fire": color = COLOR_FIRE
            elif cat == "Smoke": color = COLOR_SMOKE
            elif cat == "Person": color = COLOR_PERSON
            elif cat == "Animal": color = COLOR_ANIMAL
            else: color = COLOR_DEFAULT

            # Tactical corners / bounding box
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

            # Label Pill
            label = f"{cname.upper()} {int(conf * 100)}%"
            (lw, lh), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
            cv2.rectangle(frame, (x1, max(0, y1 - 20)), (x1 + lw + 6, max(20, y1)), color, -1)
            cv2.putText(frame, label, (x1 + 3, max(15, y1 - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 1, cv2.LINE_AA)

        # 2. Draw Top Tactical HUD Bar
        cv2.rectangle(frame, (0, 0), (w, 36), (15, 20, 30), -1)
        cv2.line(frame, (0, 36), (w, 36), (40, 55, 80), 1)

        # Tactical Title
        cv2.putText(frame, "SKYFIGHTER DRONE AI VISION", (12, 23),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 212, 255), 2)

        # Status Tag in Center
        status_box_w = 260
        sb_x = (w - status_box_w) // 2
        if alert_active:
            # Flashing RED
            alert_color = COLOR_FIRE if int(time.time() * 3) % 2 == 0 else (0, 0, 150)
            cv2.rectangle(frame, (sb_x, 3), (sb_x + status_box_w, 33), alert_color, -1)
            cv2.putText(frame, "! FIRE ALERT: LOCKED !", (sb_x + 22, 23),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)
        elif persistence > 0:
            # Amber Verifying
            cv2.rectangle(frame, (sb_x, 3), (sb_x + status_box_w, 33), COLOR_SMOKE, -1)
            cv2.putText(frame, f"VERIFYING TARGET: [{persistence}/{p_thresh}]", (sb_x + 14, 23),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 2)
        else:
            # Green Patrol
            cv2.rectangle(frame, (sb_x, 3), (sb_x + status_box_w, 33), (25, 45, 30), -1)
            cv2.rectangle(frame, (sb_x, 3), (sb_x + status_box_w, 33), COLOR_PERSON, 1)
            cv2.putText(frame, "PATROL: STANDBY (NORMAL)", (sb_x + 18, 23),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, COLOR_PERSON, 1)

        # Targets count on top right
        det_text = f"TARGETS: {len(detections)}"
        cv2.putText(frame, det_text, (w - 120, 23),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 210, 220), 1)

        return frame
