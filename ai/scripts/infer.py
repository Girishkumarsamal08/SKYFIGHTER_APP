#!/usr/bin/env python3
"""
FIRE GUARDIAN — Real-Time Inference & Temporal Persistence Engine
Runs YOLO inference on live video / USB UVC stream / video files / images.
Features:
- Multi-frame temporal confirmation filter to eliminate transient false alarms
- HUD telemetry overlay (Target Boxes, Confidence, Detection Counter, Pilot Alert Banner)
- Logging of confirmed fire detection events
"""

import os
import sys
import time
import json
import argparse
from pathlib import Path

# Prevent Ultralytics from complaining about read-only system app support directories
os.environ["YOLO_CONFIG_DIR"] = "/tmp/Ultralytics"

import cv2
import numpy as np

# Class Mappings and Bounding Box Colors (BGR)
CLASS_CONFIG = {
    0: {"name": "Human",  "color": (0, 255, 0)},      # Green
    1: {"name": "Animal", "color": (255, 255, 0)},    # Cyan
    2: {"name": "Fire",   "color": (0, 0, 255)},      # Red
    3: {"name": "Smoke",  "color": (180, 180, 180)}   # Gray
}

def parse_args():
    parser = argparse.ArgumentParser(description="FIRE GUARDIAN Real-Time Inference")
    parser.add_argument("--weights", type=str, default="runs/train/fire_guardian_detector/weights/best.pt",
                        help="Path to YOLO weights (.pt)")
    parser.add_argument("--source", type=str, default="0", help="Video source: '0' (webcam/UVC), file path, or image path")
    parser.add_argument("--conf", type=float, default=0.25, help="Confidence threshold")
    parser.add_argument("--iou", type=float, default=0.45, help="NMS IOU threshold")
    parser.add_argument("--persistence", type=int, default=8, help="Consecutive frames required for verified Fire Alert")
    parser.add_argument("--output", type=str, default="", help="Path to save output video (optional)")
    parser.add_argument("--no-show", action="store_true", help="Run headless without cv2.imshow")
    return parser.parse_args()

def check_dependencies():
    try:
        from ultralytics import YOLO
        return YOLO
    except ImportError:
        print("[ERROR] Ultralytics is not installed.")
        print("Please install requirements using: pip install -r ai_pipeline/requirements.txt")
        sys.exit(1)

def draw_hud(frame, detections, persistence_count, persistence_threshold, fps, fire_alert_active):
    """Overlays tactical HUD with target bounding boxes, confidence, and alert banner."""
    h, w, _ = frame.shape

    # 1. Draw Detections
    for det in detections:
        cls_id, conf, (x1, y1, x2, y2) = det
        cfg = CLASS_CONFIG.get(cls_id, {"name": f"Class {cls_id}", "color": (255, 255, 255)})
        color = cfg["color"]
        label = f"{cfg['name']} {conf:.2f}"

        # Bounding box
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

        # Label pill
        (lw, lh), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        cv2.rectangle(frame, (x1, max(0, y1 - 20)), (x1 + lw + 6, max(20, y1)), color, -1)
        cv2.putText(frame, label, (x1 + 3, max(15, y1 - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1, cv2.LINE_AA)

    # 2. Draw Top Status Banner
    banner_height = 50
    cv2.rectangle(frame, (0, 0), (w, banner_height), (20, 20, 20), -1)
    cv2.line(frame, (0, banner_height), (w, banner_height), (80, 80, 80), 1)

    # Title & FPS
    cv2.putText(frame, "FIRE GUARDIAN — GCS VISION", (15, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2)
    cv2.putText(frame, f"FPS: {fps:.1f}", (w - 110, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 1)

    # 3. Alert Status Box
    status_w = 340
    status_x = (w - status_w) // 2

    if fire_alert_active:
        # Flashing RED Banner: Fire Locked
        alert_bg = (0, 0, 220) if int(time.time() * 3) % 2 == 0 else (0, 0, 140)
        cv2.rectangle(frame, (status_x, 5), (status_x + status_w, 45), alert_bg, -1)
        cv2.putText(frame, "! FIRE ALERT: PILOT ARM REQ !", (status_x + 10, 32),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    elif persistence_count > 0:
        # YELLOW Banner: Verifying Persistence
        cv2.rectangle(frame, (status_x, 5), (status_x + status_w, 45), (0, 165, 255), -1)
        cv2.putText(frame, f"VERIFYING TARGET: [{persistence_count}/{persistence_threshold}]",
                    (status_x + 15, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 2)
    else:
        # GREEN Banner: Normal Patrol
        cv2.rectangle(frame, (status_x, 5), (status_x + status_w, 45), (40, 140, 40), -1)
        cv2.putText(frame, "STATUS: PATROL / NORMAL", (status_x + 35, 32),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1)

    return frame

def resolve_weights_path(requested: str) -> Path:
    p = Path(requested)
    if p.exists() and p.is_file():
        return p.resolve()
    candidates = [
        Path("ai_pipeline/models/best.pt"),
        Path("runs/train/fire_guardian_detector/weights/best.pt"),
        Path("runs/detect/runs/train/fire_guardian_detector/weights/best.pt"),
        Path(__file__).resolve().parent.parent / "models" / "best.pt",
    ]
    for c in candidates:
        if c.exists() and c.is_file():
            print(f"[INFO] Requested weights '{requested}' auto-resolved to: {c.resolve()}")
            return c.resolve()
    return p.resolve()

def run_inference():
    args = parse_args()
    YOLO = check_dependencies()

    weights_path = resolve_weights_path(args.weights)
    if not weights_path.exists():
        print(f"[ERROR] Weights file not found: {weights_path}")
        print("Please train the model first using: python3 ai_pipeline/scripts/train.py")
        sys.exit(1)

    print(f"\n[INFO] Loading YOLO model from: {weights_path}")
    model = YOLO(str(weights_path))

    # Determine input type
    is_live = False
    source = args.source
    if source.isdigit():
        source = int(source)
        is_live = True
        cap = cv2.VideoCapture(source)
    else:
        src_path = Path(source).resolve()
        if not src_path.exists():
            print(f"[ERROR] Source not found: {src_path}")
            sys.exit(1)
        if src_path.suffix.lower() in [".jpg", ".jpeg", ".png", ".bmp"]:
            # Single Image Inference
            run_image_inference(model, src_path, args.conf, args.iou)
            return
        cap = cv2.VideoCapture(str(src_path))

    if not cap.isOpened():
        print(f"\n[ERROR] Could not open video stream: {args.source}")
        if is_live:
            print("\n" + "=" * 62)
            print("   macOS CAMERA PERMISSION REQUIRED")
            print("=" * 62)
            print("macOS blocked OpenCV from accessing camera index 0.")
            print("To authorize camera access:")
            print("  1. Open macOS 'System Settings' -> 'Privacy & Security' -> 'Camera'")
            print("  2. Turn ON the toggle next to 'Terminal' (or iTerm2 / VS Code).")
            print("  3. Close and re-open your terminal window, then re-run.")
            print("=" * 62)
            print("\n[TIP] In the meantime, you can test video inference directly on a video:")
            print("      python3 ai_pipeline/scripts/infer.py --source ai_pipeline/dataset/sample_patrol.mp4")
            print("      or on an image:")
            print("      python3 ai_pipeline/scripts/infer.py --source ai_pipeline/dataset/images/test/sample_test_0000.jpg\n")
        sys.exit(1)

    fps_meter = cv2.TickMeter()
    persistence_count = 0
    persistence_threshold = args.persistence
    fire_alert_active = False

    video_writer = None
    if args.output:
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        fps_in = cap.get(cv2.CAP_PROP_FPS) or 30.0
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 640
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 480
        video_writer = cv2.VideoWriter(args.output, fourcc, fps_in, (width, height))

    print("[INFO] Video inference active. Press 'q' or ESC in display window to exit.")

    try:
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            fps_meter.start()

            # YOLO inference
            results = model.predict(frame, conf=args.conf, iou=args.iou, verbose=False)
            boxes = results[0].boxes

            detections = []
            fire_in_frame = False

            if boxes is not None and len(boxes) > 0:
                for box in boxes:
                    cls_id = int(box.cls[0].item())
                    conf = float(box.conf[0].item())
                    xyxy = box.xyxy[0].cpu().numpy().astype(int)
                    detections.append((cls_id, conf, (xyxy[0], xyxy[1], xyxy[2], xyxy[3])))

                    # Check for Fire (Class 2) or Smoke (Class 3)
                    if cls_id in [2, 3]:
                        fire_in_frame = True

            # Multi-Frame Temporal Persistence Logic
            if fire_in_frame:
                persistence_count = min(persistence_count + 1, persistence_threshold + 5)
            else:
                persistence_count = max(persistence_count - 1, 0)

            if persistence_count >= persistence_threshold:
                if not fire_alert_active:
                    print(f"\n[ALERT - {time.strftime('%Y-%m-%d %H:%M:%S')}] FIRE/SMOKE CONFIRMED! Alerting Pilot.")
                fire_alert_active = True
            elif persistence_count == 0:
                fire_alert_active = False

            fps_meter.stop()
            current_fps = fps_meter.getFPS()
            fps_meter.reset()

            # Render HUD
            annotated_frame = draw_hud(frame, detections, persistence_count, persistence_threshold, current_fps, fire_alert_active)

            if video_writer:
                video_writer.write(annotated_frame)

            if not args.no_show:
                cv2.imshow("FIRE GUARDIAN — Ground Station Vision", annotated_frame)
                key = cv2.waitKey(1) & 0xFF
                if key in [ord('q'), 27]: # 'q' or ESC
                    break

    finally:
        cap.release()
        if video_writer:
            video_writer.release()
            print(f"[OK] Saved output video to: {args.output}")
        cv2.destroyAllWindows()

def run_image_inference(model, image_path, conf, iou):
    """Inference for a single still image."""
    img = cv2.imread(str(image_path))
    if img is None:
        print(f"[ERROR] Failed to load image: {image_path}")
        return

    results = model.predict(img, conf=conf, iou=iou, verbose=False)
    boxes = results[0].boxes
    detections = []
    if boxes is not None and len(boxes) > 0:
        for box in boxes:
            cls_id = int(box.cls[0].item())
            score = float(box.conf[0].item())
            xyxy = box.xyxy[0].cpu().numpy().astype(int)
            detections.append((cls_id, score, (xyxy[0], xyxy[1], xyxy[2], xyxy[3])))

    annotated = draw_hud(img, detections, 0, 8, 0.0, False)
    out_path = Path("runs/detect") / f"detected_{image_path.name}"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_path), annotated)
    print(f"[OK] Detected image saved to: {out_path}")

if __name__ == "__main__":
    run_inference()
