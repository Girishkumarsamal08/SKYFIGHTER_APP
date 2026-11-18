#!/usr/bin/env python3
"""
FIRE GUARDIAN — Ground Control Station (GCS) Web Dashboard
Real-time browser-based AI vision, telemetry, and payload control dashboard.
"""

import os
import sys
import time
import threading
from pathlib import Path

# Set environment caches
os.environ["YOLO_CONFIG_DIR"] = "/tmp/Ultralytics"
os.environ["MPLCONFIGDIR"] = "/tmp/matplotlib"

import cv2
import numpy as np
from flask import Flask, render_template, Response, request, jsonify
from ultralytics import YOLO

app = Flask(__name__)

# Tactical BGR Class Colors
CLASS_CONFIG = {
    0: {"name": "Human",  "color": (0, 255, 0)},      # Green
    1: {"name": "Animal", "color": (255, 255, 0)},    # Cyan
    2: {"name": "Fire",   "color": (0, 0, 255)},      # Red
    3: {"name": "Smoke",  "color": (180, 180, 180)}   # Gray
}

# Global State
state = {
    "source_mode": "camera",  # "camera" or "patrol"
    "conf_thresh": 0.25,
    "persistence": 0,
    "persistence_thresh": 6,
    "fire_alert_active": False,
    "pilot_armed": False,
    "pump_active": False,
    "pump_countdown": 0.0,
    "pump_cooldown": 0.0,
    "fps": 0.0,
    "latency_ms": 0.0,
    "counts": {"Human": 0, "Animal": 0, "Fire": 0, "Smoke": 0},
    "lock": threading.Lock()
}

def resolve_weights():
    candidates = [
        Path("ai_pipeline/models/best.pt"),
        Path("runs/train/fire_guardian_detector/weights/best.pt"),
        Path("runs/detect/runs/train/fire_guardian_detector/weights/best.pt"),
        Path(__file__).resolve().parent.parent / "models" / "best.pt",
    ]
    for c in candidates:
        if c.exists() and c.is_file():
            return str(c.resolve())
    return "yolov8n.pt"

weights_path = resolve_weights()
print(f"[INFO] Initializing YOLO model from: {weights_path}")
model = YOLO(weights_path)

patrol_video_path = Path(__file__).resolve().parent.parent / "dataset" / "sample_patrol.mp4"

def generate_frames():
    global state
    cap = None
    last_source = None
    fps_meter = cv2.TickMeter()

    while True:
        with state["lock"]:
            mode = state["source_mode"]
            conf = state["conf_thresh"]
            p_thresh = state["persistence_thresh"]
            armed = state["pilot_armed"]

        # Switch Video Source if requested
        if cap is None or mode != last_source:
            if cap is not None:
                cap.release()
            last_source = mode

            if mode == "camera":
                cap = cv2.VideoCapture(0)
                if not cap.isOpened():
                    print("[WARN] Camera index 0 could not be opened. Falling back to patrol video.")
                    mode = "patrol"
                    last_source = "patrol"
                    cap = cv2.VideoCapture(str(patrol_video_path))
            else:
                cap = cv2.VideoCapture(str(patrol_video_path))

        ret, frame = cap.read()
        if not ret:
            # Loop sample video when it finishes
            if mode == "patrol" or not cap.isOpened():
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                ret, frame = cap.read()
            if not ret:
                time.sleep(0.03)
                continue

        fps_meter.start()
        start_t = time.time()

        # Run YOLO Inference
        results = model.predict(frame, conf=conf, iou=0.45, verbose=False)
        boxes = results[0].boxes

        detections = []
        fire_in_frame = False
        counts = {"Human": 0, "Animal": 0, "Fire": 0, "Smoke": 0}

        if boxes is not None and len(boxes) > 0:
            for box in boxes:
                cls_id = int(box.cls[0].item())
                score = float(box.conf[0].item())
                xyxy = box.xyxy[0].cpu().numpy().astype(int)
                detections.append((cls_id, score, xyxy))

                cname = CLASS_CONFIG.get(cls_id, {}).get("name")
                if cname in counts:
                    counts[cname] += 1
                if cls_id in [2, 3]: # Fire or Smoke
                    fire_in_frame = True

        # Temporal Persistence Logic
        with state["lock"]:
            if fire_in_frame:
                state["persistence"] = min(state["persistence"] + 1, p_thresh + 4)
            else:
                state["persistence"] = max(state["persistence"] - 1, 0)

            if state["persistence"] >= p_thresh:
                state["fire_alert_active"] = True
            elif state["persistence"] == 0:
                state["fire_alert_active"] = False

            # Pump timer decrement
            if state["pump_active"]:
                state["pump_countdown"] -= 0.05
                if state["pump_countdown"] <= 0:
                    state["pump_active"] = False
                    state["pump_countdown"] = 0
                    state["pump_cooldown"] = 5.0 # Enforce 5s cooldown
                    print("[INFO] Water pump 3-second cycle finished. Safe shutdown.")

            if state["pump_cooldown"] > 0:
                state["pump_cooldown"] = max(0.0, state["pump_cooldown"] - 0.05)

            p_count = state["persistence"]
            alert_active = state["fire_alert_active"]
            pump_is_on = state["pump_active"]

        fps_meter.stop()
        fps_val = fps_meter.getFPS()
        fps_meter.reset()
        latency = (time.time() - start_t) * 1000

        with state["lock"]:
            state["fps"] = fps_val if fps_val > 0 else 30.0
            state["latency_ms"] = latency
            state["counts"] = counts

        # Draw Annotations on Frame
        h, w, _ = frame.shape
        for cls_id, score, (x1, y1, x2, y2) in detections:
            cfg = CLASS_CONFIG.get(cls_id, {"name": f"Class {cls_id}", "color": (255, 255, 255)})
            color = cfg["color"]
            label = f"{cfg['name']} {score:.2f}"

            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            (lw, lh), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            cv2.rectangle(frame, (x1, max(0, y1 - 20)), (x1 + lw + 6, max(20, y1)), color, -1)
            cv2.putText(frame, label, (x1 + 3, max(15, y1 - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1, cv2.LINE_AA)

        # Draw Spray Status overlay if active
        if pump_is_on:
            cv2.rectangle(frame, (20, h - 60), (320, h - 20), (0, 200, 255), -1)
            cv2.putText(frame, ">>> WATER PUMP ACTIVE <<<", (30, h - 35),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)

        # Encode Frame to JPEG
        ret_enc, buffer = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        if not ret_enc:
            continue

        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/video_feed')
def video_feed():
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/api/telemetry')
def get_telemetry():
    with state["lock"]:
        return jsonify({
            "fps": state["fps"],
            "latency_ms": state["latency_ms"],
            "counts": state["counts"],
            "persistence": state["persistence"],
            "persistence_threshold": state["persistence_thresh"],
            "fire_alert_active": state["fire_alert_active"],
            "pilot_armed": state["pilot_armed"],
            "pump_active": state["pump_active"],
            "pump_countdown": round(state["pump_countdown"], 1),
            "pump_cooldown": round(state["pump_cooldown"], 1)
        })

@app.route('/api/set_source', methods=['POST'])
def set_source():
    data = request.get_json() or {}
    src = data.get("source", "camera")
    with state["lock"]:
        state["source_mode"] = src
    return jsonify({"status": "ok", "source": src})

@app.route('/api/set_conf', methods=['POST'])
def set_conf():
    data = request.get_json() or {}
    val = float(data.get("conf", 0.25))
    with state["lock"]:
        state["conf_thresh"] = val
    return jsonify({"status": "ok", "conf": val})

@app.route('/api/pilot_arm', methods=['POST'])
def pilot_arm():
    data = request.get_json() or {}
    armed = bool(data.get("armed", False))
    with state["lock"]:
        state["pilot_armed"] = armed
    return jsonify({"status": "ok", "armed": armed})

@app.route('/api/trigger_pump', methods=['POST'])
def trigger_pump():
    with state["lock"]:
        # Safety conditions: Pilot must be ARMED AND fire locked AND not in cooldown
        if not state["pilot_armed"]:
            return jsonify({"status": "error", "message": "Pilot must be ARMED first!"}), 400
        if not state["fire_alert_active"]:
            return jsonify({"status": "error", "message": "Target not locked by AI persistence filter!"}), 400
        if state["pump_cooldown"] > 0:
            return jsonify({"status": "error", "message": f"Pump in cooldown ({state['pump_cooldown']:.1f}s remaining)"}), 400

        state["pump_active"] = True
        state["pump_countdown"] = 3.0 # 3.0 second hardware timed spray
    return jsonify({"status": "ok", "message": "Pump triggered for 3 seconds"})

@app.route('/api/emergency_stop', methods=['POST'])
def emergency_stop():
    with state["lock"]:
        state["pump_active"] = False
        state["pump_countdown"] = 0
        state["pilot_armed"] = False
        state["pump_cooldown"] = 10.0
    return jsonify({"status": "ok", "message": "Emergency shutdown activated"})

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    print(f"\n========================================================")
    print(f"   FIRE GUARDIAN GCS WEB DASHBOARD ACTIVE")
    print(f"   Open in your browser: http://localhost:{port}")
    print(f"========================================================\n")
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)
