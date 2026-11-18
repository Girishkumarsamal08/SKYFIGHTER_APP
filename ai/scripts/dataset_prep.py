#!/usr/bin/env python3
"""
FIRE GUARDIAN — Dataset Preparation & Formatting Pipeline
Target Classes:
  0: Human
  1: Animal
  2: Fire
  3: Smoke
"""

import os
import sys
import glob
import shutil
import random
import argparse
from pathlib import Path
import cv2
import numpy as np

# Class Mappings
CLASSES = {
    0: "Human",
    1: "Animal",
    2: "Fire",
    3: "Smoke"
}

def create_directory_structure(base_dir: Path):
    """Creates YOLO standard directory layout."""
    splits = ["train", "val", "test"]
    for split in splits:
        (base_dir / "images" / split).mkdir(parents=True, exist_ok=True)
        (base_dir / "labels" / split).mkdir(parents=True, exist_ok=True)
    print(f"[OK] Directory structure initialized at: {base_dir}")

def generate_mock_verification_dataset(base_dir: Path, num_train=40, num_val=10, num_test=5):
    """
    Generates synthetic validation images representing forest environments,
    flames, smoke, humans, animals, and negative distractors (sunsets/autumn leaves).
    Allows immediate verification of the training pipeline before large dataset download.
    """
    create_directory_structure(base_dir)
    print("[INFO] Generating synthetic verification dataset...")

    splits = {
        "train": num_train,
        "val": num_val,
        "test": num_test
    }

    random.seed(42)
    np.random.seed(42)

    for split, count in splits.items():
        img_dir = base_dir / "images" / split
        lbl_dir = base_dir / "labels" / split

        for i in range(count):
            # Create synthetic 640x640 forest background (greens, browns, dark tones)
            img = np.zeros((640, 640, 3), dtype=np.uint8)
            forest_color = [random.randint(20, 60), random.randint(50, 110), random.randint(20, 50)]
            img[:] = forest_color

            # Add random noise/texture to simulate canopy
            noise = np.random.randint(-15, 15, (640, 640, 3), dtype=np.int16)
            img = np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)

            labels = []
            sample_type = random.choice(["fire_smoke", "human", "animal", "negative_distractor", "mixed"])

            if sample_type in ["fire_smoke", "mixed"]:
                # Draw simulated Fire (Class 2: Bright Yellow/Orange/Red)
                fx, fy = random.randint(150, 450), random.randint(200, 500)
                fw, fh = random.randint(50, 120), random.randint(60, 140)
                cv2.ellipse(img, (fx, fy), (fw//2, fh//2), 0, 0, 360, (0, 140, 255), -1)
                cv2.ellipse(img, (fx, fy), (fw//4, fh//3), 0, 0, 360, (50, 240, 255), -1)
                labels.append(f"2 {fx/640:.6f} {fy/640:.6f} {fw/640:.6f} {fh/640:.6f}")

                # Draw simulated Smoke (Class 3: Semi-transparent Gray plume above fire)
                sx, sy = fx + random.randint(-20, 20), max(50, fy - fh - random.randint(30, 60))
                sw, sh = fw + random.randint(40, 100), fh + random.randint(40, 80)
                overlay = img.copy()
                cv2.ellipse(overlay, (sx, sy), (sw//2, sh//2), 0, 0, 360, (180, 180, 180), -1)
                cv2.addWeighted(overlay, 0.45, img, 0.55, 0, img)
                labels.append(f"3 {sx/640:.6f} {sy/640:.6f} {sw/640:.6f} {sh/640:.6f}")

            if sample_type in ["human", "mixed"]:
                # Draw simulated Human (Class 0: Vertical marker)
                hx, hy = random.randint(100, 540), random.randint(250, 520)
                hw, hh = random.randint(30, 50), random.randint(70, 110)
                cv2.rectangle(img, (hx - hw//2, hy - hh//2), (hx + hw//2, hy + hh//2), (180, 100, 50), -1)
                cv2.circle(img, (hx, hy - hh//2), hw//3, (200, 160, 140), -1)
                labels.append(f"0 {hx/640:.6f} {hy/640:.6f} {hw/640:.6f} {hh/640:.6f}")

            if sample_type == "animal":
                # Draw simulated Animal (Class 1: Horizontal quadruped profile)
                ax, ay = random.randint(100, 540), random.randint(250, 520)
                aw, ah = random.randint(60, 90), random.randint(35, 55)
                cv2.ellipse(img, (ax, ay), (aw//2, ah//2), 0, 0, 360, (80, 80, 120), -1)
                labels.append(f"1 {ax/640:.6f} {ay/640:.6f} {aw/640:.6f} {ah/640:.6f}")

            if sample_type == "negative_distractor":
                # Distractor: Sunset sky reflection / autumn orange patch (NO labels = False positive suppressor)
                dx, dy = random.randint(200, 440), random.randint(100, 300)
                cv2.circle(img, (dx, dy), random.randint(60, 110), (0, 80, 200), -1)
                # Intentionally leave labels empty!

            img_file = img_dir / f"sample_{split}_{i:04d}.jpg"
            lbl_file = lbl_dir / f"sample_{split}_{i:04d}.txt"

            cv2.imwrite(str(img_file), img)
            with open(lbl_file, "w") as f:
                f.write("\n".join(labels))

    print(f"[OK] Synthetic verification dataset successfully created in: {base_dir}")

def verify_dataset(base_dir: Path):
    """Scans dataset directories, validates label coordinates and prints statistics."""
    print(f"\n[INFO] Validating dataset at: {base_dir}")
    total_images = 0
    class_counts = {0: 0, 1: 0, 2: 0, 3: 0}
    empty_label_count = 0
    error_count = 0

    for split in ["train", "val", "test"]:
        img_dir = base_dir / "images" / split
        lbl_dir = base_dir / "labels" / split

        if not img_dir.exists() or not lbl_dir.exists():
            print(f"[WARN] Split {split} directory does not exist.")
            continue

        images = list(img_dir.glob("*.jpg")) + list(img_dir.glob("*.png"))
        total_images += len(images)
        split_boxes = 0

        for img_p in images:
            lbl_p = lbl_dir / f"{img_p.stem}.txt"
            if not lbl_p.exists():
                print(f"[ERROR] Missing label file for image: {img_p.name}")
                error_count += 1
                continue

            with open(lbl_p, "r") as f:
                lines = [l.strip() for l in f.readlines() if l.strip()]

            if len(lines) == 0:
                empty_label_count += 1
                continue

            for line in lines:
                parts = line.split()
                if len(parts) != 5:
                    print(f"[ERROR] Malformed label line in {lbl_p.name}: '{line}'")
                    error_count += 1
                    continue
                try:
                    cls_id = int(parts[0])
                    xc, yc, w, h = map(float, parts[1:])
                    if cls_id not in CLASSES:
                        print(f"[ERROR] Unknown class ID {cls_id} in {lbl_p.name}")
                        error_count += 1
                    if not (0.0 <= xc <= 1.0 and 0.0 <= yc <= 1.0 and 0.0 < w <= 1.0 and 0.0 < h <= 1.0):
                        print(f"[ERROR] Coordinate out of bounds in {lbl_p.name}: {line}")
                        error_count += 1
                    class_counts[cls_id] = class_counts.get(cls_id, 0) + 1
                    split_boxes += 1
                except ValueError as e:
                    print(f"[ERROR] Number format error in {lbl_p.name}: {e}")
                    error_count += 1

        print(f"  Split '{split}': {len(images)} images, {split_boxes} annotations.")

    print("\n--- Dataset Summary ---")
    print(f"Total Images: {total_images}")
    print(f"Negative (Background) Images: {empty_label_count}")
    for cid, cname in CLASSES.items():
        print(f"  Class {cid} ({cname}): {class_counts.get(cid, 0)} bounding boxes")
    print(f"Errors Found: {error_count}")
    return error_count == 0

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="FIRE GUARDIAN Dataset Preparation Utility")
    parser.add_argument("--data-dir", type=str, default="../dataset", help="Target dataset directory")
    parser.add_argument("--init", action="store_true", help="Initialize empty directory structure")
    parser.add_argument("--mock", action="store_true", help="Generate synthetic verification dataset")
    parser.add_argument("--verify", action="store_true", help="Verify dataset integrity and display metrics")

    args = parser.parse_args()
    target_path = Path(__file__).resolve().parent / args.data_dir

    if args.init:
        create_directory_structure(target_path)
    elif args.mock:
        generate_mock_verification_dataset(target_path)
        verify_dataset(target_path)
    elif args.verify:
        verify_dataset(target_path)
    else:
        parser.print_help()
