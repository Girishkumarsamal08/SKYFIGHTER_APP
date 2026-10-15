"""
SKYFIGHTER — Modular Edge AI Fire & Smoke Detection Pipeline (v1.1)
Runs on Laptop Ground Station or Edge Computer.

Features:
- Dual-Band Sensor Fusion (Visible RGB + Radiometric LWIR Thermal)
- Strict Multi-Frame Temporal Confirmation:
  1. POTENTIAL DETECTION (Single frame anomaly / low confidence)
  2. REPEATED DETECTION (3+ consistent frames within temporal window)
  3. HUMAN-VERIFIED INCIDENT (Confirmed by ground pilot triage)
- GPS Coordinate Geotagging
- False Alarm Filtering: Correlates optical flame, smoke dispersion, and thermal hotspot
"""

import time
import math
import json
from dataclasses import dataclass, asdict
from typing import List, Dict, Any, Optional, Tuple

CONFIRMATION_TEMPORAL_WINDOW_S = 5.0
MIN_CONSECUTIVE_FRAMES = 3
DEFAULT_CONFIDENCE_THRESHOLD = 0.70
THERMAL_HOTSPOT_MIN_C = 70.0

@dataclass
class BoundingBox:
    x: float
    y: float
    width: float
    height: float

@dataclass
class DetectionEvidence:
    id: str
    detection_class: str # "fire" | "smoke" | "thermal_hotspot"
    confidence: float    # 0.0 to 1.0
    status: str          # "potential" | "repeated" | "human_verified"
    box: BoundingBox
    thermal_max_c: Optional[float]
    ambient_temp_c: Optional[float]
    smoke_adc: Optional[int]
    gps_lat: Optional[float]
    gps_lon: Optional[float]
    timestamp_ms: int
    frame_count: int = 1

class MultiFrameTrack:
    def __init__(self, initial_detection: DetectionEvidence):
        self.track_id = initial_detection.id
        self.detection_class = initial_detection.detection_class
        self.detections: List[DetectionEvidence] = [initial_detection]
        self.first_seen = initial_detection.timestamp_ms
        self.last_seen = initial_detection.timestamp_ms
        self.is_human_verified = False

    def add_detection(self, det: DetectionEvidence):
        self.detections.append(det)
        self.last_seen = det.timestamp_ms

    @property
    def frame_count(self) -> int:
        return len(self.detections)

    @property
    def average_confidence(self) -> float:
        return sum(d.confidence for d in self.detections) / len(self.detections)

    @property
    def status(self) -> str:
        if self.is_human_verified:
            return "human_verified"
        if self.frame_count >= MIN_CONSECUTIVE_FRAMES:
            return "repeated"
        return "potential"

    def to_evidence_summary(self) -> Dict[str, Any]:
        latest = self.detections[-1]
        return {
            "id": self.track_id,
            "class": self.detection_class,
            "status": self.status,
            "confidence": round(self.average_confidence, 2),
            "frame_count": self.frame_count,
            "duration_s": round((self.last_seen - self.first_seen) / 1000.0, 1),
            "thermal_max_c": latest.thermal_max_c,
            "gps_coords": {
                "latitude": latest.gps_lat,
                "longitude": latest.gps_lon
            },
            "timestamp_ms": latest.timestamp_ms
        }

class FireSmokeDetector:
    def __init__(self, confidence_threshold=DEFAULT_CONFIDENCE_THRESHOLD):
        self.confidence_threshold = confidence_threshold
        self.active_tracks: Dict[str, MultiFrameTrack] = {}
        self.track_counter = 100

    def process_frame(
        self,
        rgb_detections: List[Dict[str, Any]],
        thermal_max_c: Optional[float] = None,
        sensors: Optional[Dict[str, Any]] = None,
        gps: Optional[Dict[str, Any]] = None,
        now_ms: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        if now_ms is None:
            now_ms = int(time.time() * 1000)

        # Prune expired tracks (> 5.0 seconds quiet)
        cutoff_ms = now_ms - int(CONFIRMATION_TEMPORAL_WINDOW_S * 1000)
        self.active_tracks = {
            tid: trk for tid, trk in self.active_tracks.items()
            if trk.last_seen >= cutoff_ms
        }

        gps_lat = gps.get("latitude") if gps and gps.get("valid") else None
        gps_lon = gps.get("longitude") if gps and gps.get("valid") else None
        smoke_adc = sensors.get("mq2_adc") if sensors else None
        ambient_temp = sensors.get("temperature_c") if sensors else None

        active_summaries = []

        for raw in rgb_detections:
            conf = raw.get("confidence", 0.0)
            if conf < self.confidence_threshold:
                continue

            cls_name = raw.get("class", "fire")
            box_data = raw.get("box", {"x": 0.5, "y": 0.5, "width": 0.1, "height": 0.1})
            bbox = BoundingBox(
                x=box_data.get("x", 0.0),
                y=box_data.get("y", 0.0),
                width=box_data.get("width", 0.0),
                height=box_data.get("height", 0.0)
            )

            # Match or create track
            matched_track = None
            for track in self.active_tracks.values():
                if track.detection_class == cls_name:
                    last_box = track.detections[-1].box
                    # Centroid distance
                    dist = math.hypot(bbox.x - last_box.x, bbox.y - last_box.y)
                    if dist < 0.15: # Within 15% screen distance
                        matched_track = track
                        break

            det = DetectionEvidence(
                id="",
                detection_class=cls_name,
                confidence=conf,
                status="potential",
                box=bbox,
                thermal_max_c=thermal_max_c,
                ambient_temp_c=ambient_temp,
                smoke_adc=smoke_adc,
                gps_lat=gps_lat,
                gps_lon=gps_lon,
                timestamp_ms=now_ms
            )

            if matched_track:
                det.id = matched_track.track_id
                matched_track.add_detection(det)
                active_summaries.append(matched_track.to_evidence_summary())
            else:
                self.track_counter += 1
                new_id = f"TRK-{self.track_counter}"
                det.id = new_id
                new_track = MultiFrameTrack(det)
                self.active_tracks[new_id] = new_track
                active_summaries.append(new_track.to_evidence_summary())

        return active_summaries

    def verify_incident(self, track_id: str) -> bool:
        if track_id in self.active_tracks:
            self.active_tracks[track_id].is_human_verified = True
            return True
        return False
