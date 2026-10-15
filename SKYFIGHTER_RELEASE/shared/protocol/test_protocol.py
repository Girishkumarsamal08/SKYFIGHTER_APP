import time
from protocol import (
    parse_incoming_packet,
    sanitize_manual_input,
    RateLimiter,
    SequenceValidator,
    evaluate_composite_hazard,
    ProtocolError
)

def test_protocol_python():
    print("--- RUNNING PYTHON PROTOCOL TESTS ---")
    now_ms = int(time.time() * 1000)
    
    # 1. Valid telemetry
    valid_json = f"""{{
        "version": 1,
        "type": "telemetry",
        "timestamp_ms": {now_ms},
        "connection": "connected",
        "flight": {{
            "mode": "disarmed",
            "armed": false,
            "capabilities": {{
                "manual_control": false,
                "autonomous_navigation": false,
                "return_to_home": false
            }}
        }},
        "sensors": {{
            "temperature_c": 29.1,
            "mq2_adc": 410,
            "flame_detected": false
        }},
        "gps": {{
            "valid": true,
            "latitude": 37.7749,
            "longitude": -122.4194
        }},
        "battery": {{
            "voltage_v": null
        }},
        "alerts": []
    }}"""
    pkt = parse_incoming_packet(valid_json)
    assert pkt["version"] == 1
    assert pkt["sensors"]["temperature_c"] == 29.1
    print("✔ Python Test 1: Valid packet parsed")
    
    # 2. Oversized packet
    oversized = '{"version": 1, "type": "telemetry", "data": "' + ('A' * 5000) + '"}'
    try:
        parse_incoming_packet(oversized)
        assert False, "Should have thrown PACKET_TOO_LARGE"
    except ProtocolError as e:
        assert "PACKET_TOO_LARGE" in str(e)
    print("✔ Python Test 2: Oversized packet rejected")
    
    # 3. Disarmed throttle clamp
    clamped = sanitize_manual_input(roll=2.0, pitch=-3.0, throttle=0.8, is_armed=False)
    assert clamped["roll"] == 1.0
    assert clamped["pitch"] == -1.0
    assert clamped["throttle"] == 0.0
    print("✔ Python Test 3: Disarmed throttle locked to 0.0")
    
    # 4. Sequence validation
    sv = SequenceValidator()
    assert sv.validate_next(1)
    assert sv.validate_next(10)
    try:
        sv.validate_next(5)
        assert False, "Should reject decreasing sequence"
    except ProtocolError:
        pass
    print("✔ Python Test 4: Sequence validation passed")
    
    # 5. Composite hazard
    h = evaluate_composite_hazard({"flame_detected": True, "temperature_c": 55.0})
    assert h["state"] == "MULTI_SENSOR_ALERT"
    print("✔ Python Test 5: Composite hazard passed")
    
    print("\n--- ALL PYTHON PROTOCOL TESTS PASSED! ---")

if __name__ == "__main__":
    test_protocol_python()
