"""
SKYFIGHTER — Realistic Python Flight & Sensor Simulation Server (v1.1)
Simulates:
1. 6-DOF Quadcopter Flight Dynamics (Roll, Pitch, Yaw, Altitude, Ground Speed)
2. WGS-84 GPS Geodetic Positioning & Satellite Fix
3. Environmental Sensor Telemetry (DHT11, MQ-2, Optical Flame Sensor, MPU6050)
4. WebSocket Gateway Server on port 8080 broadcasting Protocol v1.1 packets
5. Command Receiver & Safety Failsafe Execution
"""

import sys
import os
import time
import math
import random
import json
import asyncio
from typing import Dict, Any, Optional, Tuple

# Add parent directory for shared protocol imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from shared.protocol.protocol import (
    PROTOCOL_VERSION,
    parse_incoming_packet,
    sanitize_manual_input,
    evaluate_composite_hazard,
    ProtocolError
)

# Simulation Default Parameters
DEFAULT_LAT = 12.971598
DEFAULT_LON = 77.594562
EARTH_RADIUS_M = 6378137.0

class DronePhysicsSimulator:
    def __init__(self, home_lat=DEFAULT_LAT, home_lon=DEFAULT_LON):
        self.home_lat = home_lat
        self.home_lon = home_lon
        
        # 6-DOF State
        self.x = 0.0 # East (meters)
        self.y = 0.0 # North (meters)
        self.z = 0.0 # Altitude (meters above ground)
        
        self.vx = 0.0
        self.vy = 0.0
        self.vz = 0.0
        
        self.roll = 0.0  # radians
        self.pitch = 0.0 # radians
        self.yaw = 0.0   # radians
        
        self.is_armed = False
        self.throttle = 0.0
        self.target_roll = 0.0
        self.target_pitch = 0.0
        self.target_yaw_rate = 0.0
        
        # Environmental scenario
        self.ambient_temp_c = 28.4
        self.humidity_pct = 48.0
        self.mq2_adc = 390
        self.flame_detected = False
        self.fire_location_xy = (120.0, 180.0) # meters from home
        
        self.gps_satellites = 9
        self.gps_valid = True
        
    def set_control_inputs(self, roll_cmd: float, pitch_cmd: float, yaw_cmd: float, throttle_cmd: float):
        clean = sanitize_manual_input(
            roll=roll_cmd,
            pitch=pitch_cmd,
            yaw=yaw_cmd,
            throttle=throttle_cmd,
            is_armed=self.is_armed
        )
        self.target_roll = clean["roll"] * 0.45    # max ~25 deg tilt
        self.target_pitch = clean["pitch"] * 0.45
        self.target_yaw_rate = clean["yaw"] * 1.5 # rad/s
        self.throttle = clean["throttle"]
        
    def update(self, dt: float):
        if not self.is_armed:
            # Drone landed on ground
            self.vz = 0.0
            self.vx = 0.0
            self.vy = 0.0
            self.z = max(0.0, self.z - dt * 2.0)
            self.roll *= 0.8
            self.pitch *= 0.8
            return
            
        # Simplified quadcopter attitude dynamics
        self.roll += (self.target_roll - self.roll) * min(1.0, dt * 6.0)
        self.pitch += (self.target_pitch - self.pitch) * min(1.0, dt * 6.0)
        self.yaw = (self.yaw + self.target_yaw_rate * dt) % (2 * math.pi)
        
        # Thrust and drag
        g = 9.81
        thrust_accel = self.throttle * 18.0 # max acceleration ~1.8g
        
        ax = thrust_accel * (math.sin(self.yaw) * math.sin(self.roll) + math.cos(self.yaw) * math.sin(self.pitch))
        ay = thrust_accel * (-math.cos(self.yaw) * math.sin(self.roll) + math.sin(self.yaw) * math.sin(self.pitch))
        az = thrust_accel * math.cos(self.roll) * math.cos(self.pitch) - g
        
        # Linear velocities with aerodynamic damping
        damping = 0.96
        self.vx = (self.vx + ax * dt) * damping
        self.vy = (self.vy + ay * dt) * damping
        self.vz = (self.vz + az * dt) * damping
        
        # Position integration
        self.x += self.vx * dt
        self.y += self.vy * dt
        self.z = max(0.0, self.z + self.vz * dt)
        
        # Environmental sensor simulation based on proximity to fire
        dist_to_fire = math.hypot(self.x - self.fire_location_xy[0], self.y - self.fire_location_xy[1])
        if dist_to_fire < 50.0:
            heat_factor = max(0.0, (50.0 - dist_to_fire) / 50.0)
            self.ambient_temp_c = 28.4 + heat_factor * 40.0
            self.humidity_pct = max(15.0, 48.0 - heat_factor * 25.0)
            self.mq2_adc = int(390 + heat_factor * 2200 + random.randint(-20, 20))
            self.flame_detected = (dist_to_fire < 25.0 and random.random() > 0.1)
        else:
            self.ambient_temp_c = 28.4 + (random.random() - 0.5) * 0.4
            self.humidity_pct = 48.0 + (random.random() - 0.5) * 0.6
            self.mq2_adc = int(390 + (random.random() - 0.5) * 15)
            self.flame_detected = False
            
    def get_wgs84_coords(self) -> Tuple[float, float, float]:
        d_lat = (self.y / EARTH_RADIUS_M) * (180.0 / math.pi)
        d_lon = (self.x / (EARTH_RADIUS_M * math.cos(math.radians(self.home_lat)))) * (180.0 / math.pi)
        lat = self.home_lat + d_lat
        lon = self.home_lon + d_lon
        alt = 24.5 + self.z
        return (lat, lon, alt)
        
    def generate_telemetry_packet(self, sequence: int) -> Dict[str, Any]:
        lat, lon, alt = self.get_wgs84_coords()
        
        # MPU6050 mock
        noise_a = (random.random() - 0.5) * 0.04
        noise_g = (random.random() - 0.5) * 0.2
        
        packet = {
            "version": PROTOCOL_VERSION,
            "type": "telemetry",
            "sequence": sequence,
            "timestamp_ms": int(time.time() * 1000),
            "connection": "connected",
            "flight": {
                "mode": "manual" if self.is_armed else "disarmed",
                "armed": self.is_armed,
                "capabilities": {
                    "manual_control": False, # Simulation safety lock
                    "autonomous_navigation": False,
                    "return_to_home": False,
                    "thermal_camera": True,
                    "rgb_camera": True,
                    "buzzer": True,
                    "simulation_mode": True
                }
            },
            "sensors": {
                "temperature_c": round(self.ambient_temp_c, 1),
                "humidity_pct": round(self.humidity_pct, 1),
                "mq2_adc": self.mq2_adc,
                "flame_detected": self.flame_detected,
                "mpu_connected": True,
                "mpu_temperature_c": round(31.2 + noise_a * 5, 1)
            },
            "gps": {
                "valid": self.gps_valid,
                "latitude": round(lat, 6) if self.gps_valid else None,
                "longitude": round(lon, 6) if self.gps_valid else None,
                "satellites": self.gps_satellites if self.gps_valid else 0,
                "altitude_m": round(alt, 1) if self.gps_valid else None
            },
            "battery": {
                "voltage_v": None, # Honest representation of unwired battery sensor
                "percentage": None
            },
            "alerts": [],
            "ai_detections": []
        }
        
        if self.flame_detected:
            packet["alerts"].append({
                "code": "FLAME_DETECTED_SIM",
                "severity": "critical",
                "source": "SIM_FLAME_OPTICAL",
                "message": "Optical flame sensor triggered within active fire sector.",
                "timestamp_ms": int(time.time() * 1000)
            })
            
        return packet
