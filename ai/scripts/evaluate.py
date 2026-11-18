#!/usr/bin/env python3
"""
FIRE GUARDIAN — Model Evaluation & Metrics Reporting
Computes Precision, Recall, F1-Score, mAP@0.5, mAP@0.5:0.95, and Confusion Matrix.
"""

import os
import sys
import argparse
from pathlib import Path

# Prevent Ultralytics and Matplotlib from complaining about read-only system app support directories
os.environ["YOLO_CONFIG_DIR"] = "/tmp/Ultralytics"
os.environ["MPLCONFIGDIR"] = "/tmp/matplotlib"

import numpy as np
import torch

CLASSES = {
    0: "Human",
    1: "Animal",
    2: "Fire",
    3: "Smoke"
}

def parse_args():
    parser = argparse.ArgumentParser(description="FIRE GUARDIAN Model Evaluation")
    parser.add_argument("--weights", type=str, default="runs/train/fire_guardian_detector/weights/best.pt",
                        help="Path to trained weights (best.pt)")
    parser.add_argument("--data", type=str, default=str(Path(__file__).resolve().parent.parent / "config" / "data.yaml"),
                        help="Path to data.yaml")
    parser.add_argument("--split", type=str, default="test", choices=["val", "test"], help="Dataset split to evaluate")
    parser.add_argument("--imgsz", type=int, default=640, help="Evaluation image size")
    parser.add_argument("--device", type=str, default="", help="Device: '0', 'mps', or 'cpu'")
    return parser.parse_args()

def check_dependencies():
    try:
        from ultralytics import YOLO
        return YOLO
    except ImportError:
        print("[ERROR] Ultralytics is not installed.")
        print("Please install requirements using: pip install -r ai_pipeline/requirements.txt")
        sys.exit(1)

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

def evaluate():
    args = parse_args()
    YOLO = check_dependencies()

    weights_path = resolve_weights_path(args.weights)
    if not weights_path.exists():
        print(f"[ERROR] Weights file not found: {weights_path}")
        print("Please train the model first using: python3 ai_pipeline/scripts/train.py")
        sys.exit(1)

    print(f"\n==================================================")
    print(f"   FIRE GUARDIAN MODEL VALIDATION & METRICS")
    print(f"==================================================")
    print(f"Weights : {weights_path}")
    print(f"Data    : {args.data}")
    print(f"Split   : {args.split}")
    print(f"==================================================\n")

    model = YOLO(str(weights_path))

    metrics = model.val(
        data=args.data,
        split=args.split,
        imgsz=args.imgsz,
        device=args.device if args.device else ("mps" if torch.backends.mps.is_available() else "cpu"),
        save_json=True,
        plots=True
    )

    # Global Metrics
    precision = metrics.box.mp
    recall = metrics.box.mr
    map50 = metrics.box.map50
    map50_95 = metrics.box.map
    f1 = (2 * precision * recall) / (precision + recall + 1e-9)

    print("\n================== OVERALL METRICS ==================")
    print(f"Precision (P)    : {precision:.4f} ({precision * 100:.2f}%)")
    print(f"Recall (R)       : {recall:.4f} ({recall * 100:.2f}%)")
    print(f"F1-Score         : {f1:.4f} ({f1 * 100:.2f}%)")
    print(f"mAP @ 0.5        : {map50:.4f} ({map50 * 100:.2f}%)")
    print(f"mAP @ 0.5:0.95   : {map50_95:.4f} ({map50_95 * 100:.2f}%)")
    print("====================================================\n")

    # Per-Class Breakdown
    print(f"{'Class ID':<10}{'Class Name':<15}{'Precision':<12}{'Recall':<12}{'F1-Score':<12}{'mAP@0.5':<12}")
    print("-" * 73)

    for i, cname in CLASSES.items():
        if hasattr(metrics.box, 'p') and i < len(metrics.box.p):
            p_c = metrics.box.p[i]
            r_c = metrics.box.r[i]
            f1_c = (2 * p_c * r_c) / (p_c + r_c + 1e-9)
            map50_c = metrics.box.ap50[i]
            print(f"{i:<10}{cname:<15}{p_c:<12.4f}{r_c:<12.4f}{f1_c:<12.4f}{map50_c:<12.4f}")

    print("\n[INFO] Confusion matrix and validation curve plots are saved in:")
    print(f"       {metrics.save_dir}")

if __name__ == "__main__":
    evaluate()
