# SKYFIGHTER / FIRE GUARDIAN — Edge AI Detection Model

This directory contains the YOLOv8 / YOLOv11 aerial computer vision pipeline and trained weights for forest fire detection, wildlife/human rescue monitoring, and water spraying payload control.

---

## 1. Detection Classes

| Class ID | Class Name | Color Code | Operational Action |
| :---: | :--- | :---: | :--- |
| **0** | **Human** | Green `(0, 255, 0)` | Search & Rescue Tagging / Ground Personnel Warning |
| **1** | **Animal** | Cyan `(255, 255, 0)` | Wildlife Conservation & Evacuation Warning |
| **2** | **Fire** | Red `(0, 0, 255)` | Target Lock $\rightarrow$ Water Spray Payload Authorization |
| **3** | **Smoke** | Gray `(180, 180, 180)` | Early Canopy Smolder Warning / Fire Tracking |

---

## 2. Directory Layout

```text
SKYFIGHTER_APP/ai/
├── weights/
│   └── best.pt               # Trained YOLO weights (5.9 MB, 3.0M params)
├── config/
│   └── data.yaml             # Dataset configuration
├── scripts/
│   ├── train.py              # YOLO training engine with aerial augmentations
│   ├── infer.py              # Real-time GCS inference & temporal persistence filter
│   ├── evaluate.py           # Precision, Recall, F1, and Confusion Matrix
│   └── dataset_prep.py       # Dataset verification & formatting
├── dashboard/                # Real-time GCS Web Dashboard (Flask + HTML5)
│   ├── app.py
│   └── templates/index.html
├── detector.py               # Multi-frame temporal confirmation engine
└── requirements.txt          # Python dependencies
```

---

## 3. Quick Start

### Install Dependencies
```bash
pip install -r requirements.txt
```

### Run Real-Time Vision Inference on Camera / UVC Video Grabber
```bash
python scripts/infer.py --weights weights/best.pt --source 0 --persistence 8
```

### Launch Web GCS Dashboard
```bash
python dashboard/app.py
```
Open `http://localhost:5000` in your browser. The web GCS seamlessly streams the AI bounding boxes, temporal alert status, and water spray control interlocks.
