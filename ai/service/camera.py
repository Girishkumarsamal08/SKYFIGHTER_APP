"""
SKYFIGHTER DRONE VISION — CAMERA STREAMER
Decoupled multi-threaded video capture service with automatic reconnection.
Supports AI-Thinker ESP32-CAM Wi-Fi stream, Local Webcam, and Drone Simulation Video.
"""

import cv2
import time
import threading
from typing import Tuple, Optional
from pathlib import Path
from ai_pipeline.service.config import settings

class CameraStreamer:
    def __init__(self):
        self.source_type: str = settings.CAMERA_SOURCE
        self.esp32_url: str = settings.ESP32_CAM_URL
        self.webcam_idx: int = settings.WEBCAM_INDEX
        self.video_path: str = settings.PATROL_VIDEO_PATH

        self._lock = threading.Lock()
        self._running = False
        self._thread: Optional[threading.Thread] = None

        self._latest_frame = None
        self._latest_timestamp: float = 0.0
        self._fps: float = 0.0
        self._width: int = 640
        self._height: int = 480
        self._connected: bool = False
        self._start_time: float = time.time()
        self._reconnect_attempts: int = 0

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._capture_loop, daemon=True, name="CameraCaptureThread")
        self._thread.start()
        print(f"[CameraStreamer] Started capture loop. Source: {self.source_type}")

    def stop(self):
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        self._connected = False
        print("[CameraStreamer] Stopped capture loop.")

    def set_source(self, source_type: str, url: Optional[str] = None):
        with self._lock:
            self.source_type = source_type
            if url:
                self.esp32_url = url
            self._connected = False
            self._reconnect_attempts = 0
        print(f"[CameraStreamer] Switched source to: {self.source_type} (URL: {self.esp32_url})")

    def get_latest_frame(self) -> Tuple[Optional[any], float]:
        with self._lock:
            if self._latest_frame is None:
                return None, 0.0
            return self._latest_frame.copy(), self._latest_timestamp

    def get_status(self) -> dict:
        with self._lock:
            age_ms = (time.time() - self._latest_timestamp) * 1000 if self._latest_timestamp > 0 else 9999.0
            return {
                "connected": self._connected,
                "source": self.source_type,
                "stream_url": self.esp32_url if self.source_type == "esp32_cam" else f"device_{self.webcam_idx}",
                "fps": round(self._fps, 1),
                "resolution": [self._width, self._height],
                "last_frame_age_ms": round(age_ms, 1),
                "uptime_seconds": round(time.time() - self._start_time, 1),
                "reconnect_attempts": self._reconnect_attempts
            }

    def _open_capture(self) -> Optional[cv2.VideoCapture]:
        cap = None
        if self.source_type == "esp32_cam":
            print(f"[CameraStreamer] Connecting to ESP32-CAM MJPEG stream at {self.esp32_url}...")
            cap = cv2.VideoCapture(self.esp32_url)
            # Reduce OpenCV internal buffer size to 1 frame for minimum latency
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        elif self.source_type == "webcam":
            print(f"[CameraStreamer] Opening local webcam device index {self.webcam_idx}...")
            cap = cv2.VideoCapture(self.webcam_idx)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        else:
            # Simulation video
            sim_path = Path(self.video_path)
            if not sim_path.exists():
                print(f"[CameraStreamer] Sim video not found at {sim_path}. Creating fallback test clip.")
                self._create_fallback_video(sim_path)
            print(f"[CameraStreamer] Opening simulated patrol clip: {sim_path}")
            cap = cv2.VideoCapture(str(sim_path))

        if cap and cap.isOpened():
            ret, test_frame = cap.read()
            if ret and test_frame is not None:
                h, w = test_frame.shape[:2]
                with self._lock:
                    self._width = w
                    self._height = h
                    self._connected = True
                print(f"[CameraStreamer] Stream connected successfully ({w}x{h})")
                return cap

        print(f"[CameraStreamer] Failed to open source '{self.source_type}'")
        return None

    def _capture_loop(self):
        fps_timer = cv2.TickMeter()
        cap = None

        while self._running:
            if cap is None or not cap.isOpened():
                cap = self._open_capture()
                if cap is None or not cap.isOpened():
                    with self._lock:
                        self._connected = False
                        self._reconnect_attempts += 1
                    time.sleep(2.0)
                    continue

            fps_timer.start()
            ret, frame = cap.read()

            if not ret or frame is None:
                # Video ended or Wi-Fi packet dropped
                if self.source_type == "simulation":
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    time.sleep(0.03)
                    continue
                else:
                    print("[CameraStreamer] Frame read failed. Reconnecting...")
                    cap.release()
                    cap = None
                    with self._lock:
                        self._connected = False
                    time.sleep(1.0)
                    continue

            fps_timer.stop()
            calc_fps = fps_timer.getFPS()
            fps_timer.reset()

            h, w = frame.shape[:2]
            now = time.time()

            with self._lock:
                self._latest_frame = frame
                self._latest_timestamp = now
                self._width = w
                self._height = h
                self._connected = True
                self._fps = calc_fps if calc_fps > 0 else 30.0

            # Rate limit simulation playback to realistic drone flight framerate
            if self.source_type == "simulation":
                time.sleep(0.033)

        if cap:
            cap.release()

    def _create_fallback_video(self, output_path: Path):
        """Generates a synthetic 30-frame aerial test pattern if sample video is missing."""
        import numpy as np
        output_path.parent.mkdir(parents=True, exist_ok=True)
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(str(output_path), fourcc, 20.0, (640, 480))
        for i in range(60):
            frame = np.zeros((480, 640, 3), dtype=np.uint8)
            # Green tree canopy
            frame[:, :] = (20, 60, 20)
            # Simulated smoke/fire spot
            cv2.circle(frame, (320 + int(i * 2), 240), 30, (0, 100, 255), -1)
            cv2.putText(frame, f"AERIAL SIMULATION FRAME {i}", (40, 50),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
            out.write(frame)
        out.release()
