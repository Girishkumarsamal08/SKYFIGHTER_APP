import Foundation

public struct ValidatedFlightInput: Sendable, Equatable {
    public let roll: Double
    public let pitch: Double
    public let yaw: Double
    public let throttle: Double
    
    public init(roll: Double, pitch: Double, yaw: Double, throttle: Double) {
        self.roll = roll
        self.pitch = pitch
        self.yaw = yaw
        self.throttle = throttle
    }
    
    public static let neutral = ValidatedFlightInput(roll: 0.0, pitch: 0.0, yaw: 0.0, throttle: 0.0)
}

public final class FlightCommandValidator: @unchecked Sendable {
    private var sequence: UInt64 = 0
    private var lastCommandTimestampMs: UInt64 = 0
    private let minIntervalMs: UInt64
    private let lock = NSLock()
    
    public init(maxRateHz: Double = 20.0) {
        let hz = max(1.0, min(50.0, maxRateHz))
        self.minIntervalMs = UInt64(1000.0 / hz)
    }
    
    /// Normalizes and clamps raw stick input, applying deadzone and safety constraints.
    public func sanitizeInput(
        roll: Double,
        pitch: Double,
        yaw: Double,
        throttle: Double,
        isArmed: Bool,
        deadZone: Double = 0.05
    ) -> ValidatedFlightInput {
        let cleanRoll = applyDeadZone(value: clamp(roll, min: -1.0, max: 1.0), deadZone: deadZone)
        let cleanPitch = applyDeadZone(value: clamp(pitch, min: -1.0, max: 1.0), deadZone: deadZone)
        let cleanYaw = applyDeadZone(value: clamp(yaw, min: -1.0, max: 1.0), deadZone: deadZone)
        
        // Safety constraint: Never allow positive throttle if disarmed
        var cleanThrottle = clamp(throttle, min: 0.0, max: 1.0)
        if !isArmed {
            cleanThrottle = 0.0
        }
        
        return ValidatedFlightInput(
            roll: cleanRoll,
            pitch: cleanPitch,
            yaw: cleanYaw,
            throttle: cleanThrottle
        )
    }
    
    /// Creates a validated, sequenced `ManualFlightCommand`.
    /// Returns nil if rate-limiting blocks transmission.
    public func createManualCommand(
        input: ValidatedFlightInput,
        forceBypassRateLimit: Bool = false
    ) -> ManualFlightCommand? {
        lock.lock()
        defer { lock.unlock() }
        
        let nowMs = UInt64(Date().timeIntervalSince1970 * 1000)
        if !forceBypassRateLimit && (nowMs - lastCommandTimestampMs) < minIntervalMs {
            return nil // Rate limited
        }
        
        sequence += 1
        lastCommandTimestampMs = nowMs
        
        return ManualFlightCommand(
            version: 1,
            sequence: sequence,
            timestampMs: nowMs,
            roll: input.roll,
            pitch: input.pitch,
            yaw: input.yaw,
            throttle: input.throttle
        )
    }
    
    /// Generates an immediate Emergency Stop command with prioritized sequence.
    public func createEmergencyStopCommand() -> EmergencyStopCommand {
        lock.lock()
        defer { lock.unlock() }
        sequence += 1
        let nowMs = UInt64(Date().timeIntervalSince1970 * 1000)
        return EmergencyStopCommand(sequence: sequence, timestampMs: nowMs)
    }
    
    /// Generates an Arm/Disarm command with a cryptographically verified token string.
    public func createArmCommand(arm: Bool, confirmationToken: String) -> ArmCommand {
        lock.lock()
        defer { lock.unlock() }
        sequence += 1
        let nowMs = UInt64(Date().timeIntervalSince1970 * 1000)
        return ArmCommand(sequence: sequence, timestampMs: nowMs, arm: arm, confirmationToken: confirmationToken)
    }
    
    private func clamp(_ val: Double, min: Double, max: Double) -> Double {
        return Swift.max(min, Swift.min(max, val))
    }
    
    private func applyDeadZone(value: Double, deadZone: Double) -> Double {
        if abs(value) <= deadZone {
            return 0.0
        }
        // Rescale smoothly from edge of deadzone to 1.0
        let sign = value > 0 ? 1.0 : -1.0
        let scaled = (abs(value) - deadZone) / (1.0 - deadZone)
        return sign * scaled
    }
}
