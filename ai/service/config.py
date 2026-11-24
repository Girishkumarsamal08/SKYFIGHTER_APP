"""
SKYFIGHTER DRONE VISION — CONFIGURATION
Environment-driven configuration for camera streaming and YOLO inference.
"""

import os
from pathlib import Path
from pydantic import BaseModel

# Base directories
BASE_DIR = Path(__file__).resolve().parent.parent.parent
AI_DIR = BASE_DIR / "ai_pipeline"
MODELS_DIR = AI_DIR / "models"
DATASET_DIR = AI_DIR / "dataset"

class Settings(BaseModel):
    # Server network binding
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))

    # Camera Stream Source: "simulation", "esp32_cam", or "webcam"
    CAMERA_SOURCE: str = os.getenv("CAMERA_SOURCE", "esp32_cam")
    ESP32_CAM_URL: str = os.getenv("ESP32_CAM_URL", "http://192.168.4.1/stream")
    WEBCAM_INDEX: int = int(os.getenv("WEBCAM_INDEX", "0"))
    PATROL_VIDEO_PATH: str = os.getenv("PATROL_VIDEO_PATH", str(DATASET_DIR / "sample_patrol.mp4"))

    # AI Model Weights
    FIRE_SMOKE_MODEL_PATH: str = os.getenv("FIRE_SMOKE_MODEL_PATH", str(MODELS_DIR / "best.pt"))
    COCO_MODEL_PATH: str = os.getenv("COCO_MODEL_PATH", str(BASE_DIR / "yolov8n.pt"))

    # Confidence Thresholds by Class
    CONF_FIRE: float = float(os.getenv("CONF_FIRE", "0.30"))
    CONF_SMOKE: float = float(os.getenv("CONF_SMOKE", "0.30"))
    CONF_PERSON: float = float(os.getenv("CONF_PERSON", "0.45"))
    CONF_ANIMAL: float = float(os.getenv("CONF_ANIMAL", "0.40"))
    CONF_DEFAULT: float = float(os.getenv("CONF_DEFAULT", "0.40"))

    # Temporal Persistence & Alert Filter
    PERSISTENCE_THRESHOLD: int = int(os.getenv("PERSISTENCE_THRESHOLD", "6"))
    ALERT_COOLDOWN_SEC: float = float(os.getenv("ALERT_COOLDOWN_SEC", "10.0"))

    # Target Stream Settings
    STREAM_FPS: int = int(os.getenv("STREAM_FPS", "30"))
    JPEG_QUALITY: int = int(os.getenv("JPEG_QUALITY", "80"))

settings = Settings()
