import assert from 'node:assert';
import {
  parseIncomingPacket,
  sanitizeManualInput,
  RateLimiter,
  SequenceValidator,
  ControlLeaseManager,
  evaluateCompositeHazard,
  ProtocolError
} from './protocol.js';

console.log('--- RUNNING SKYFIGHTER PROTOCOL AUTOMATED TESTS ---');

// 1. Valid Telemetry Packet Parsing
{
  const now = Date.now();
  const validPacket = JSON.stringify({
    version: 1,
    type: 'telemetry',
    timestamp_ms: now,
    connection: 'connected',
    flight: {
      mode: 'disarmed',
      armed: false,
      capabilities: {
        manual_control: false,
        autonomous_navigation: false,
        return_to_home: false
      }
    },
    sensors: {
      temperature_c: 28.5,
      humidity_pct: 45.2,
      mq2_adc: 320,
      flame_detected: false,
      mpu_connected: true,
      mpu_temperature_c: 30.1
    },
    gps: {
      valid: true,
      latitude: 12.9716,
      longitude: 77.5946,
      satellites: 9,
      altitude_m: 18.2
    },
    battery: {
      voltage_v: null,
      percentage: null
    },
    alerts: []
  });

  const parsed = parseIncomingPacket(validPacket);
  assert.strictEqual(parsed.version, 1);
  assert.strictEqual(parsed.sensors.temperature_c, 28.5);
  assert.strictEqual(parsed.battery.voltage_v, null);
  console.log('✔ Test 1: Valid telemetry packet parsed successfully.');
}

// 2. Reject Malformed / Over-sized Packet
{
  const hugePacket = JSON.stringify({
    version: 1,
    type: 'telemetry',
    timestamp_ms: Date.now(),
    payload: 'X'.repeat(5000)
  });

  assert.throws(() => parseIncomingPacket(hugePacket), /PACKET_TOO_LARGE/);
  console.log('✔ Test 2: Over-sized packet (>4096 bytes) rejected.');
}

// 3. Reject Unsupported Protocol Version
{
  const invalidVersion = JSON.stringify({
    version: 99,
    type: 'telemetry',
    timestamp_ms: Date.now()
  });

  assert.throws(() => parseIncomingPacket(invalidVersion), /UNSUPPORTED_VERSION/);
  console.log('✔ Test 3: Unsupported schema version rejected.');
}

// 4. Stale Telemetry Detection
{
  const stalePacket = JSON.stringify({
    version: 1,
    type: 'telemetry',
    timestamp_ms: Date.now() - 6000,
    flight: { mode: 'disarmed', armed: false, capabilities: { manual_control: false, autonomous_navigation: false, return_to_home: false } },
    sensors: {},
    gps: { valid: false },
    battery: {},
    alerts: []
  });

  assert.throws(() => parseIncomingPacket(stalePacket, 5000), /STALE_DATA/);
  console.log('✔ Test 4: Stale telemetry detected and flagged.');
}

// 5. GPS Validity Enforcement (coords cannot be missing if valid=true)
{
  const badGps = JSON.stringify({
    version: 1,
    type: 'telemetry',
    timestamp_ms: Date.now(),
    flight: { mode: 'disarmed', armed: false, capabilities: { manual_control: false, autonomous_navigation: false, return_to_home: false } },
    sensors: {},
    gps: { valid: true, latitude: null, longitude: null },
    battery: {},
    alerts: []
  });

  assert.throws(() => parseIncomingPacket(badGps), /GPS_INCOMPLETE/);
  console.log('✔ Test 5: Incomplete GPS coordinates marked valid rejected.');
}

// 6. Manual Flight Input Sanitization & Clamping
{
  const clamped = sanitizeManualInput({
    roll: 2.5,
    pitch: -1.8,
    yaw: 0.02, // within deadzone 0.05
    throttle: 0.9,
    isArmed: true,
    deadzone: 0.05
  });

  assert.strictEqual(clamped.roll, 1.0);
  assert.strictEqual(clamped.pitch, -1.0);
  assert.strictEqual(clamped.yaw, 0.0);
  assert.strictEqual(clamped.throttle, 0.9);
  console.log('✔ Test 6: Input sanitized, clamped, and deadzone applied.');
}

// 7. Disarm Throttle Safety Interlock
{
  const disarmed = sanitizeManualInput({
    roll: 0.5,
    pitch: 0.0,
    yaw: 0.0,
    throttle: 0.75,
    isArmed: false // Disarmed!
  });

  assert.strictEqual(disarmed.throttle, 0.0);
  console.log('✔ Test 7: Disarmed throttle strictly forced to 0.0.');
}

// 8. Sequence Monotonicity Validator
{
  const seq = new SequenceValidator();
  assert.strictEqual(seq.validateNext(1), true);
  assert.strictEqual(seq.validateNext(2), true);
  assert.strictEqual(seq.validateNext(5), true);
  assert.throws(() => seq.validateNext(4), /OUT_OF_ORDER_SEQUENCE/);
  assert.throws(() => seq.validateNext(5), /OUT_OF_ORDER_SEQUENCE/);
  console.log('✔ Test 8: Sequence counter monotonicity enforced.');
}

// 9. Rate Limiter Enforcement
{
  const limiter = new RateLimiter(10); // 10 Hz = 100ms
  const t0 = 1000;
  assert.strictEqual(limiter.canSend(t0), true);
  limiter.recordSend(t0);
  assert.strictEqual(limiter.canSend(t0 + 50), false); // only 50ms passed
  assert.strictEqual(limiter.canSend(t0 + 105), true); // 105ms passed
  console.log('✔ Test 9: Rate limiter enforces Hz intervals.');
}

// 10. Client Control Lease Ownership
{
  const lease = new ControlLeaseManager(1000); // 1 sec lease
  const t0 = 1000;
  
  // Client A claims
  const resA = lease.claimLease('client-A', t0);
  assert.strictEqual(resA.success, true);
  assert.strictEqual(lease.isAuthorized('client-A', t0 + 500), true);
  assert.strictEqual(lease.isAuthorized('client-B', t0 + 500), false);

  // Client B attempts preempt while active
  const resB = lease.claimLease('client-B', t0 + 500);
  assert.strictEqual(resB.success, false);
  assert.strictEqual(resB.reason, 'LEASE_BUSY');

  // Lease expires at t0 + 1000, now t0 + 1100
  assert.strictEqual(lease.isAuthorized('client-A', t0 + 1100), false);

  // Client B claims after expiration
  const resB2 = lease.claimLease('client-B', t0 + 1100);
  assert.strictEqual(resB2.success, true);
  console.log('✔ Test 10: Exclusive client control lease ownership verified.');
}

// 11. Multi-Sensor Hazard Evaluation
{
  const hazard1 = evaluateCompositeHazard({
    temperature_c: 54.0,
    mq2_adc: 400,
    flame_detected: true
  }, true, false);
  assert.strictEqual(hazard1.state, 'MULTI_SENSOR_ALERT');
  assert.strictEqual(hazard1.severity, 'critical');

  const hazard2 = evaluateCompositeHazard({
    temperature_c: 24.0,
    mq2_adc: 400,
    flame_detected: true
  }, true, false);
  assert.strictEqual(hazard2.state, 'FLAME_DETECTED');

  const hazard3 = evaluateCompositeHazard(null, false, false);
  assert.strictEqual(hazard3.state, 'COMMUNICATION_LOST');
  console.log('✔ Test 11: Multi-sensor composite hazard evaluation passed.');
}

console.log('\n--- ALL 11 PROTOCOL ENGINE TESTS PASSED! ---');
