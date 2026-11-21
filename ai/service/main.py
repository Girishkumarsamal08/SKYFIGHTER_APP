"""
SKYFIGHTER DRONE VISION — FASTAPI LIVE CAMERA & YOLO DETECTION SERVICE
======================================================================
Provides high-performance live camera streaming (ESP32-CAM / Webcam / Simulation)
and asynchronous YOLO detection events over REST and WebSockets.
"""

import os
import sys
import time
import asyncio
from typing import Optional
from pathlib import Path

# Cache path overrides
os.environ["YOLO_CONFIG_DIR"] = "/tmp/Ultralytics"
os.environ["MPLCONFIGDIR"] = "/tmp/matplotlib"

import cv2
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, Request, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from ai_pipeline.service.config import settings
from ai_pipeline.service.camera import CameraStreamer
from ai_pipeline.service.detector import YOLOInferenceEngine

app = FastAPI(
    title="SKYFIGHTER Drone Vision API",
    description="Real-time ESP32-CAM / Webcam video streaming and YOLO object detection service.",
    version="2.0.0"
)

# Enable CORS for all origins (supports local development and Vercel cloud deployment)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Instantiate core streaming and inference components
streamer = CameraStreamer()
detector = YOLOInferenceEngine(camera_streamer=streamer)

# WebSocket Connection Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, data: dict):
        for connection in list(self.active_connections):
            try:
                await connection.send_json(data)
            except Exception:
                self.disconnect(connection)

ws_manager = ConnectionManager()

# Background broadcast task
async def websocket_broadcast_loop():
    while True:
        try:
            if ws_manager.active_connections:
                status = streamer.get_status()
                snapshot = detector.get_latest_snapshot()
                payload = {
                    "type": "telemetry",
                    "camera": status,
                    "detections": snapshot["active_detections"],
                    "counts": snapshot["counts"],
                    "persistence": snapshot["persistence"],
                    "persistence_threshold": snapshot["persistence_threshold"],
                    "fire_alert_active": snapshot["fire_alert_active"],
                    "cumulative": snapshot["cumulative_statistics"],
                    "timestamp": round(time.time(), 3)
                }
                await ws_manager.broadcast(payload)
        except Exception as e:
            pass
        await asyncio.sleep(0.1) # 10 Hz broadcast

@app.on_event("startup")
async def on_startup():
    print("[FastAPI] Starting Camera Streamer and YOLO Engine...")
    streamer.start()
    detector.start()
    asyncio.create_task(websocket_broadcast_loop())

@app.on_event("shutdown")
async def on_shutdown():
    print("[FastAPI] Stopping Camera Streamer and YOLO Engine...")
    detector.stop()
    streamer.stop()

# ------------------------------------------------------------------------------
# REST API ENDPOINTS
# ------------------------------------------------------------------------------

@app.get("/")
def read_root():
    return {
        "service": "SKYFIGHTER Drone Vision API",
        "version": "2.0.0",
        "status": "online",
        "camera_status_url": "/api/camera/status",
        "camera_stream_url": "/api/camera/stream",
        "detections_url": "/api/detections",
        "detections_latest_url": "/api/detections/latest",
        "websocket_url": "/ws/detections"
    }

@app.get("/api/camera/status")
def get_camera_status():
    """Returns camera connection state, frame rate, resolution, and latency."""
    status = streamer.get_status()
    snapshot = detector.get_latest_snapshot()
    status["fire_alert_active"] = snapshot["fire_alert_active"]
    status["counts"] = snapshot["counts"]
    status["persistence"] = snapshot["persistence"]
    return status

def generate_mjpeg_stream(annotated: bool = True):
    """Generator that yields MJPEG boundary frames without blocking inference."""
    quality = settings.JPEG_QUALITY
    while True:
        frame, timestamp = streamer.get_latest_frame()
        if frame is None:
            time.sleep(0.04)
            continue

        if annotated:
            frame = detector.annotate_frame(frame)

        ret, buffer = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
        if not ret:
            time.sleep(0.03)
            continue

        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
        
        time.sleep(1.0 / settings.STREAM_FPS)

@app.get("/api/camera/stream")
def get_camera_stream(annotated: bool = Query(True, description="Overlay AI bounding boxes and tactical HUD")):
    """Returns real-time MJPEG camera stream accessible by website <img> tags."""
    return StreamingResponse(
        generate_mjpeg_stream(annotated=annotated),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

@app.get("/api/detections")
def get_detections_history(limit: int = Query(50, ge=1, le=150)):
    """Returns chronologically ordered detection event history."""
    return {
        "total_events": len(detector.event_history),
        "events": detector.get_history(limit=limit)
    }

@app.get("/api/detections/latest")
def get_detections_latest():
    """Returns the most recent detection snapshot and aggregate stats."""
    return detector.get_latest_snapshot()

@app.websocket("/ws/detections")
async def websocket_detections_endpoint(websocket: WebSocket):
    """Real-time WebSocket endpoint streaming detection coordinates and telemetry at 10Hz."""
    await ws_manager.connect(websocket)
    try:
        while True:
            # Keep connection alive; accept optional client commands
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception:
        ws_manager.disconnect(websocket)

# ------------------------------------------------------------------------------
# CONFIGURATION & CONTROL ENDPOINTS
# ------------------------------------------------------------------------------

class CameraConfigPayload(BaseModel):
    source: str # "esp32_cam", "webcam", "simulation"
    url: Optional[str] = None

@app.post("/api/camera/config")
def update_camera_config(payload: CameraConfigPayload):
    """Switches the camera stream between ESP32-CAM, local webcam, and simulated video."""
    if payload.source not in ["esp32_cam", "webcam", "simulation"]:
        raise HTTPException(status_code=400, detail="Invalid source type. Choose esp32_cam, webcam, or simulation.")
    streamer.set_source(source_type=payload.source, url=payload.url)
    return {"status": "ok", "source": payload.source, "url": payload.url}

class DetectionConfigPayload(BaseModel):
    conf_fire: Optional[float] = None
    conf_smoke: Optional[float] = None
    conf_person: Optional[float] = None
    conf_animal: Optional[float] = None
    persistence: Optional[int] = None
    cooldown: Optional[float] = None

@app.post("/api/detection/config")
def update_detection_config(payload: DetectionConfigPayload):
    """Dynamically adjusts per-class detection confidence thresholds and alert timing."""
    detector.update_config(
        conf_fire=payload.conf_fire,
        conf_smoke=payload.conf_smoke,
        conf_person=payload.conf_person,
        conf_animal=payload.conf_animal,
        persistence=payload.persistence,
        cooldown=payload.cooldown
    )
    return {"status": "ok", "message": "Detection thresholds updated successfully."}

@app.post("/api/alerts/clear")
def clear_active_alerts():
    """Resets persistent fire and smoke alert state."""
    detector.clear_alerts()
    return {"status": "ok", "message": "Alert state reset to normal."}

def run_server():
    """Entrypoint to run with Uvicorn programmatically."""
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"\n========================================================")
    print(f"   SKYFIGHTER DRONE VISION — FASTAPI SERVICE")
    print(f"   Listening on: http://{host}:{port}")
    print(f"   Camera Stream: http://{host}:{port}/api/camera/stream")
    print(f"   WebSocket:    ws://{host}:{port}/ws/detections")
    print(f"========================================================\n")
    uvicorn.run("ai_pipeline.service.main:app", host=host, port=port, reload=False, log_level="info")

if __name__ == "__main__":
    run_server()
