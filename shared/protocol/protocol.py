"""
SKYFIGHTER Core Protocol Engine & Validator (Python v1.1)
Used by Flight Simulator, AI Fire Detection Engine, and Laptop Ground Station.
"""

import time
import json
from typing import Dict, Any, Tuple, Optional

PROTOCOL_VERSION = 1
MAX_PACKET_BYTES = 4096
TELEMETRY_STALE_MS = 2500
TELEMETRY_LOST_MS = 5000
DEFAULT_MAX_COMMAND_RATE_HZ = 20
CONTROL_LEASE_DURATION_MS = 3000

class ProtocolError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(f"[{code}] {message}")
        self.code = code

def parse_incoming_packet(raw_string: str, max_age_ms: int = TELEMETRY_LOST_MS) -> Dict[str, Any]:
    if not isinstance(raw_string, str):
        raise ProtocolError("INVALID_INPUT", "Incoming packet must be a string")
        
    encoded = raw_string.encode('utf-8')
    if len(encoded) > MAX_PACKET_BYTES:
        raise ProtocolError("PACKET_TOO_LARGE", f"Packet size {len(encoded)}B exceeds {MAX_PACKET_BYTES}B")
        
    try:
        packet = json.loads(raw_string)
    except Exception as e:
        raise ProtocolError("INVALID_JSON", f"Failed to parse JSON: {str(e)}")
        
    if not isinstance(packet, dict):
        raise ProtocolError("MALFORMED_PACKET", "Packet must be a JSON object")
        
    if packet.get("version") != PROTOCOL_VERSION:
        raise ProtocolError("UNSUPPORTED_VERSION", f"Protocol version {packet.get('version')} not supported")
        
    packet_type = packet.get("type")
    if not packet_type or not isinstance(packet_type, str):
        raise ProtocolError("MISSING_TYPE", "Packet missing valid type property")
        
    if packet_type == "telemetry":
        validate_telemetry_structure(packet, max_age_ms)
        
    return packet

def validate_telemetry_structure(packet: Dict[str, Any], max_age_ms: int = TELEMETRY_LOST_MS):
    ts = packet.get("timestamp_ms")
    if not isinstance(ts, (int, float)) or ts < 0:
        raise ProtocolError("INVALID_TIMESTAMP", "Telemetry packet missing valid timestamp_ms")
        
    now_ms = int(time.time() * 1000)
    if now_ms - ts > max_age_ms:
        raise ProtocolError("STALE_DATA", f"Telemetry packet timestamp is stale ({now_ms - ts}ms old)")
        
    flight = packet.get("flight")
    if not isinstance(flight, dict):
        raise ProtocolError("INVALID_FLIGHT", "Missing flight status block")
        
    valid_modes = {"disarmed", "manual", "autonomous", "failsafe", "unknown"}
    if flight.get("mode") not in valid_modes:
        raise ProtocolError("INVALID_FLIGHT_MODE", f"Unknown flight mode: {flight.get('mode')}")
        
    if not isinstance(flight.get("armed"), bool):
        raise ProtocolError("INVALID_ARMED_STATE", "Flight armed state must be boolean")
        
    capabilities = flight.get("capabilities")
    if not isinstance(capabilities, dict):
        raise ProtocolError("INVALID_CAPABILITIES", "Missing flight capabilities block")
        
    gps = packet.get("gps")
    if not isinstance(gps, dict) or not isinstance(gps.get("valid"), bool):
        raise ProtocolError("INVALID_GPS", "Missing or malformed GPS block (valid boolean required)")
        
    if gps.get("valid") is True:
        if gps.get("latitude") is None or gps.get("longitude") is None:
            raise ProtocolError("GPS_INCOMPLETE", "GPS marked valid but coordinates are null")
            
    if not isinstance(packet.get("sensors"), dict):
        raise ProtocolError("INVALID_SENSORS", "Missing sensors block")
        
    if not isinstance(packet.get("alerts"), list):
        raise ProtocolError("INVALID_ALERTS", "Alerts property must be a list")

def sanitize_manual_input(
    roll: float = 0.0,
    pitch: float = 0.0,
    yaw: float = 0.0,
    throttle: float = 0.0,
    is_armed: bool = False,
    deadzone: float = 0.05
) -> Dict[str, float]:
    def dead(v: float) -> float:
        return 0.0 if abs(v) < deadzone else v
    def clamp(v: float, mn: float, mx: float) -> float:
        return max(mn, min(mx, v))
        
    clean_roll = clamp(dead(roll), -1.0, 1.0)
    clean_pitch = clamp(dead(pitch), -1.0, 1.0)
    clean_yaw = clamp(dead(yaw), -1.0, 1.0)
    clean_throttle = clamp(throttle, 0.0, 1.0) if is_armed else 0.0
    
    return {
        "roll": clean_roll,
        "pitch": clean_pitch,
        "yaw": clean_yaw,
        "throttle": clean_throttle
    }

class RateLimiter:
    def __init__(self, max_hz: float = DEFAULT_MAX_COMMAND_RATE_HZ):
        self.min_interval = 1.0 / max_hz
        self.last_timestamp = 0.0
        
    def can_send(self, now: Optional[float] = None) -> bool:
        if now is None:
            now = time.time()
        return (now - self.last_timestamp) >= self.min_interval
        
    def record_send(self, now: Optional[float] = None):
        if now is None:
            now = time.time()
        self.last_timestamp = now

class SequenceValidator:
    def __init__(self):
        self.last_sequence = 0
        
    def validate_next(self, seq: int) -> bool:
        if not isinstance(seq, int) or seq <= 0:
            raise ProtocolError("INVALID_SEQUENCE", f"Sequence must be positive integer, got {seq}")
        if seq <= self.last_sequence:
            raise ProtocolError("OUT_OF_ORDER_SEQUENCE", f"Sequence {seq} <= last {self.last_sequence}")
        self.last_sequence = seq
        return True

def evaluate_composite_hazard(sensors: Optional[Dict[str, Any]], is_connected: bool = True, is_stale: bool = False) -> Dict[str, str]:
    if not is_connected:
        return {"state": "COMMUNICATION_LOST", "severity": "critical", "message": "Drone communication lost."}
    if is_stale:
        return {"state": "STALE_DATA", "severity": "warning", "message": "Telemetry data is stale."}
    if not sensors:
        return {"state": "NORMAL", "severity": "info", "message": "Sensor payload normal."}
        
    flame = sensors.get("flame_detected") is True
    temp = sensors.get("temperature_c")
    is_high_temp = isinstance(temp, (int, float)) and temp >= 50.0
    mq2 = sensors.get("mq2_adc")
    is_smoke = isinstance(mq2, (int, float)) and mq2 >= 1000
    
    if flame and is_high_temp:
        return {"state": "MULTI_SENSOR_ALERT", "severity": "critical", "message": "CRITICAL: High temp & active flame detected!"}
    if flame:
        return {"state": "FLAME_DETECTED", "severity": "critical", "message": "CRITICAL: Flame optical sensor triggered!"}
    if is_high_temp:
        return {"state": "HIGH_TEMPERATURE", "severity": "warning", "message": f"WARNING: Ambient temperature {temp:.1f}C exceeds threshold."}
    if is_smoke:
        return {"state": "POSSIBLE_SMOKE", "severity": "warning", "message": f"WARNING: Smoke sensor reading {mq2} exceeds threshold."}
        
    return {"state": "NORMAL", "severity": "info", "message": "All environmental sensors normal."}
