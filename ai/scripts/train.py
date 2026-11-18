#!/usr/bin/env python3
"""
FIRE GUARDIAN — Model Training Pipeline (YOLOv8 / YOLOv11)
Classes: Human (0), Animal (1), Fire (2), Smoke (3)
"""

import os
import sys
import argparse
from pathlib import Path

# Prevent Ultralytics and Matplotlib from complaining about read-only system app support directories
os.environ["YOLO_CONFIG_DIR"] = "/tmp/Ultralytics"
os.environ["MPLCONFIGDIR"] = "/tmp/matplotlib"

import torch

def parse_args():
    parser = argparse.ArgumentParser(description="FIRE GUARDIAN YOLO Training Engine")
    parser.add_argument("--model", type=str, default="yolov8n.yaml", help="Weights (.pt) or Architecture (.yaml)")
    parser.add_argument("--data", type=str, default=str(Path(__file__).resolve().parent.parent / "config" / "data.yaml"),
                        help="Path to data.yaml")
    parser.add_argument("--epochs", type=int, default=15, help="Number of training epochs")
    parser.add_argument("--batch", type=int, default=8, help="Batch size")
    parser.add_argument("--imgsz", type=int, default=640, help="Input image dimension (square)")
    parser.add_argument("--device", type=str, default="", help="Device: '0' (NVIDIA GPU), 'mps' (Apple Silicon), or 'cpu'")
    parser.add_argument("--project", type=str, default="runs/train", help="Destination project directory")
    parser.add_argument("--name", type=str, default="fire_guardian_detector", help="Experiment name")
    return parser.parse_args()

def check_dependencies():
    try:
        from ultralytics import YOLO
        return YOLO
    except ImportError:
        print("[ERROR] Ultralytics is not installed.")
        print("Please install requirements using: pip install -r ai_pipeline/requirements.txt")
        sys.exit(1)

def select_optimal_device(requested_device: str):
    if requested_device:
        return requested_device
    if torch.cuda.is_available():
        print(f"[INFO] NVIDIA GPU detected: {torch.cuda.get_device_name(0)}")
        return "0"
    elif torch.backends.mps.is_available():
        print("[INFO] Apple Silicon GPU (MPS) detected.")
        return "mps"
    else:
        print("[INFO] No dedicated accelerator found. Using CPU.")
        return "cpu"

def train():
    args = parse_args()
    YOLO = check_dependencies()

    device = select_optimal_device(args.device)
    data_yaml = Path(args.data).resolve()

    if not data_yaml.exists():
        print(f"[ERROR] data.yaml not found at: {data_yaml}")
        sys.exit(1)

    print(f"\n==================================================")
    print(f"   FIRE GUARDIAN YOLO TRAINING PIPELINE")
    print(f"==================================================")
    print(f"Base Model    : {args.model}")
    print(f"Data Config   : {data_yaml}")
    print(f"Epochs        : {args.epochs}")
    print(f"Batch Size    : {args.batch}")
    print(f"Image Size    : {args.imgsz}")
    print(f"Compute Device: {device}")
    print(f"==================================================\n")

    # Load YOLO Model (Gracefully handle offline fallback to YAML architecture)
    try:
        model = YOLO(args.model)
    except Exception as e:
        if args.model.endswith(".pt"):
            print(f"[WARN] Could not load or download {args.model}: {e}")
            fallback_yaml = "yolov8n.yaml"
            print(f"[INFO] Falling back to local architecture definition: {fallback_yaml}")
            model = YOLO(fallback_yaml)
        else:
            raise e

    # Aerial & Forest Fire Specific Augmentation Hyperparameters
    train_args = {
        "data": str(data_yaml),
        "epochs": args.epochs,
        "batch": args.batch,
        "imgsz": args.imgsz,
        "device": device,
        "project": args.project,
        "name": args.name,
        "exist_ok": True,
        "save": True,
        "save_period": -1,       # Disable saving intermediate epochX.pt files to conserve disk space
        "patience": 15,          # Early stopping patience
        "optimizer": "auto",
        "verbose": True,
        "seed": 42,
        # Augmentation settings for UAV perspective
        "degrees": 15.0,         # Random rotation (drone yaw/roll drift)
        "scale": 0.5,            # Multi-scale object scaling
        "fliplr": 0.5,           # Horizontal flip
        "flipud": 0.2,           # Vertical flip (nadir & oblique aerial views)
        "mosaic": 1.0,           # Mosaic augmentation (vital for small fire detection)
        "hsv_h": 0.015,          # Hue adjustments
        "hsv_s": 0.7,            # Saturation adjustments (varying sunlight/canopy)
        "hsv_v": 0.4             # Brightness/Value adjustments (twilight/shadows)
    }

    results = model.train(**train_args)

    import shutil
    save_dir = Path(getattr(results, "save_dir", Path(args.project) / args.name))
    best_weights = save_dir / "weights" / "best.pt"
    if not best_weights.exists():
        best_weights = Path("runs/detect/runs/train") / args.name / "weights" / "best.pt"

    # Replicate best.pt to standard paths for easy inference and evaluation
    standard_destinations = [
        Path("ai_pipeline/models/best.pt"),
        Path("runs/train") / args.name / "weights" / "best.pt"
    ]
    for dest in standard_destinations:
        dest.parent.mkdir(parents=True, exist_ok=True)
        if best_weights.exists():
            shutil.copy2(best_weights, dest)

    print(f"\n[OK] Training completed successfully!")
    print(f"[OK] Best weights saved to:")
    print(f"     - {best_weights}")
    for dest in standard_destinations:
        print(f"     - {dest.resolve()}")
    print(f"[INFO] Run evaluate.py to generate confusion matrix and test metrics.")
    return best_weights

if __name__ == "__main__":
    train()
