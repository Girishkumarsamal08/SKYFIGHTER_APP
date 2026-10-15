/**
 * SKYFIGHTER Core Protocol Engine & Validator (v1.1)
 * Shared across Browser Web/PWA, Node.js Gateway, and Test Suites.
 */

export const PROTOCOL_VERSION = 1;
export const MAX_PACKET_BYTES = 4096;
export const TELEMETRY_STALE_MS = 2500;
export const TELEMETRY_LOST_MS = 5000;
export const DEFAULT_MAX_COMMAND_RATE_HZ = 20;
export const CONTROL_LEASE_DURATION_MS = 3000;

export class ProtocolError extends Error {
  constructor(code, message) {
    super(`[${code}] ${message}`);
    this.code = code;
  }
}

/**
 * Validates and parses raw incoming JSON packet strings.
 * Enforces size limits, version checks, and schema integrity.
 */
export function parseIncomingPacket(rawString, maxAgeMs = TELEMETRY_LOST_MS) {
  if (typeof rawString !== 'string') {
    throw new ProtocolError('INVALID_INPUT', 'Incoming packet must be a string');
  }

  // Enforce hardware-safe packet size limit
  const byteLength = new TextEncoder().encode(rawString).length;
  if (byteLength > MAX_PACKET_BYTES) {
    throw new ProtocolError('PACKET_TOO_LARGE', `Packet size ${byteLength}B exceeds max ${MAX_PACKET_BYTES}B`);
  }

  let packet;
  try {
    packet = JSON.parse(rawString);
  } catch (err) {
    throw new ProtocolError('INVALID_JSON', `Failed to parse JSON: ${err.message}`);
  }

  if (!packet || typeof packet !== 'object') {
    throw new ProtocolError('MALFORMED_PACKET', 'Packet must be a valid JSON object');
  }

  if (packet.version !== PROTOCOL_VERSION) {
    throw new ProtocolError('UNSUPPORTED_VERSION', `Protocol version ${packet.version} is not supported (expected ${PROTOCOL_VERSION})`);
  }

  if (!packet.type || typeof packet.type !== 'string') {
    throw new ProtocolError('MISSING_TYPE', 'Packet missing valid type property');
  }

  // Validate telemetry packets
  if (packet.type === 'telemetry') {
    validateTelemetryStructure(packet, maxAgeMs);
  }

  return packet;
}

/**
 * Validates telemetry payload structure and freshness.
 */
export function validateTelemetryStructure(packet, maxAgeMs = TELEMETRY_LOST_MS) {
  if (typeof packet.timestamp_ms !== 'number' || packet.timestamp_ms < 0) {
    throw new ProtocolError('INVALID_TIMESTAMP', 'Telemetry packet missing valid timestamp_ms');
  }

  // Stale check if now is provided/available
  const now = Date.now();
  if (now - packet.timestamp_ms > maxAgeMs) {
    throw new ProtocolError('STALE_DATA', `Telemetry packet timestamp is stale (${now - packet.timestamp_ms}ms old)`);
  }

  if (!packet.flight || typeof packet.flight !== 'object') {
    throw new ProtocolError('INVALID_FLIGHT', 'Missing flight status block');
  }

  const validModes = ['disarmed', 'manual', 'autonomous', 'failsafe', 'unknown'];
  if (!validModes.includes(packet.flight.mode)) {
    throw new ProtocolError('INVALID_FLIGHT_MODE', `Unknown flight mode: ${packet.flight.mode}`);
  }

  if (typeof packet.flight.armed !== 'boolean') {
    throw new ProtocolError('INVALID_ARMED_STATE', 'Flight armed state must be boolean');
  }

  if (!packet.flight.capabilities || typeof packet.flight.capabilities !== 'object') {
    throw new ProtocolError('INVALID_CAPABILITIES', 'Missing flight capabilities block');
  }

  if (!packet.gps || typeof packet.gps !== 'object' || typeof packet.gps.valid !== 'boolean') {
    throw new ProtocolError('INVALID_GPS', 'Missing or malformed GPS block (valid boolean required)');
  }

  // If GPS is valid, lat/lon must be numeric coordinates
  if (packet.gps.valid) {
    if (typeof packet.gps.latitude !== 'number' || typeof packet.gps.longitude !== 'number') {
      throw new ProtocolError('GPS_INCOMPLETE', 'GPS marked valid but coordinates are null or non-numeric');
    }
  }

  if (!packet.sensors || typeof packet.sensors !== 'object') {
    throw new ProtocolError('INVALID_SENSORS', 'Missing sensors block');
  }

  if (!Array.isArray(packet.alerts)) {
    throw new ProtocolError('INVALID_ALERTS', 'Alerts property must be an array');
  }
}

/**
 * Clamps and deadzones pilot joystick inputs.
 * Strictly forces throttle to 0.0 when drone is disarmed.
 */
export function sanitizeManualInput({
  roll = 0.0,
  pitch = 0.0,
  yaw = 0.0,
  throttle = 0.0,
  isArmed = false,
  deadzone = 0.05
}) {
  const applyDeadzone = (val) => (Math.abs(val) < deadzone ? 0.0 : val);
  const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

  const cleanRoll = clamp(applyDeadzone(roll), -1.0, 1.0);
  const cleanPitch = clamp(applyDeadzone(pitch), -1.0, 1.0);
  const cleanYaw = clamp(applyDeadzone(yaw), -1.0, 1.0);
  
  // Throttle cannot be negative, max 1.0. If disarmed, strictly 0.0.
  const cleanThrottle = isArmed ? clamp(throttle, 0.0, 1.0) : 0.0;

  return {
    roll: cleanRoll,
    pitch: cleanPitch,
    yaw: cleanYaw,
    throttle: cleanThrottle
  };
}

/**
 * Rate Limiter for Command Transmission
 */
export class RateLimiter {
  constructor(maxHz = DEFAULT_MAX_COMMAND_RATE_HZ) {
    this.minIntervalMs = 1000.0 / maxHz;
    this.lastTimestamp = 0;
  }

  canSend(now = Date.now()) {
    return (now - this.lastTimestamp) >= this.minIntervalMs;
  }

  recordSend(now = Date.now()) {
    this.lastTimestamp = now;
  }
}

/**
 * Validates Command Sequences (Strictly Monotonic Incrementing Counter)
 */
export class SequenceValidator {
  constructor() {
    this.lastSequence = 0;
  }

  validateNext(seq) {
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq <= 0) {
      throw new ProtocolError('INVALID_SEQUENCE', `Sequence must be positive integer, got ${seq}`);
    }
    if (seq <= this.lastSequence) {
      throw new ProtocolError('OUT_OF_ORDER_SEQUENCE', `Sequence ${seq} is not greater than last sequence ${this.lastSequence}`);
    }
    this.lastSequence = seq;
    return true;
  }

  reset() {
    this.lastSequence = 0;
  }
}

/**
 * Manages Explicit Client Control Ownership / Lease Token
 */
export class ControlLeaseManager {
  constructor(leaseDurationMs = CONTROL_LEASE_DURATION_MS) {
    this.leaseDurationMs = leaseDurationMs;
    this.currentOwnerId = null;
    this.leaseExpiresAt = 0;
  }

  claimLease(clientId, now = Date.now()) {
    if (!clientId || typeof clientId !== 'string') {
      return { success: false, reason: 'INVALID_CLIENT_ID' };
    }

    if (this.currentOwnerId && this.currentOwnerId !== clientId && now < this.leaseExpiresAt) {
      return {
        success: false,
        reason: 'LEASE_BUSY',
        owner: this.currentOwnerId,
        remainingMs: this.leaseExpiresAt - now
      };
    }

    this.currentOwnerId = clientId;
    this.leaseExpiresAt = now + this.leaseDurationMs;
    return { success: true, owner: clientId, expiresAt: this.leaseExpiresAt };
  }

  heartbeat(clientId, now = Date.now()) {
    if (this.currentOwnerId === clientId && now <= this.leaseExpiresAt) {
      this.leaseExpiresAt = now + this.leaseDurationMs;
      return true;
    }
    return false;
  }

  releaseLease(clientId) {
    if (this.currentOwnerId === clientId) {
      this.currentOwnerId = null;
      this.leaseExpiresAt = 0;
      return true;
    }
    return false;
  }

  isAuthorized(clientId, now = Date.now()) {
    return this.currentOwnerId === clientId && now <= this.leaseExpiresAt;
  }
}

/**
 * Composite Fire Hazard Evaluation Algorithm
 * Replicates and extends the tested Swift logic.
 */
export function evaluateCompositeHazard(sensors, isConnected = true, isStale = false) {
  if (!isConnected) {
    return { state: 'COMMUNICATION_LOST', severity: 'critical', message: 'Drone communication lost.' };
  }
  if (isStale) {
    return { state: 'STALE_DATA', severity: 'warning', message: 'Telemetry data is stale.' };
  }
  if (!sensors) {
    return { state: 'NORMAL', severity: 'info', message: 'Sensor payload normal.' };
  }

  const { temperature_c, mq2_adc, flame_detected } = sensors;
  const isFlame = flame_detected === true;
  const isHighTemp = typeof temperature_c === 'number' && temperature_c >= 50.0;
  const isSmoke = typeof mq2_adc === 'number' && mq2_adc >= 1000;

  if (isFlame && isHighTemp) {
    return { state: 'MULTI_SENSOR_ALERT', severity: 'critical', message: 'CRITICAL: High temp & active flame detected!' };
  }
  if (isFlame) {
    return { state: 'FLAME_DETECTED', severity: 'critical', message: 'CRITICAL: Flame optical sensor triggered!' };
  }
  if (isHighTemp) {
    return { state: 'HIGH_TEMPERATURE', severity: 'warning', message: `WARNING: Ambient temperature ${temperature_c.toFixed(1)}°C exceeds threshold.` };
  }
  if (isSmoke) {
    return { state: 'POSSIBLE_SMOKE', severity: 'warning', message: `WARNING: Smoke sensor reading ${mq2_adc} exceeds threshold.` };
  }

  return { state: 'NORMAL', severity: 'info', message: 'All environmental sensors within normal parameters.' };
}
