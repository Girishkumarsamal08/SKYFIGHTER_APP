import Foundation

/// Supported command types sent from iPhone to ESP32 #2 gateway.
public enum DroneCommand: Codable, Sendable {
    case manual(ManualFlightCommand)
    case arm(ArmCommand)
    case emergencyStop(EmergencyStopCommand)
    case setMode(SetModeCommand)
    
    enum CodingKeys: String, CodingKey {
        case type
    }
    
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "manual_command":
            self = .manual(try ManualFlightCommand(from: decoder))
        case "arm_command":
            self = .arm(try ArmCommand(from: decoder))
        case "emergency_stop":
            self = .emergencyStop(try EmergencyStopCommand(from: decoder))
        case "set_mode_command":
            self = .setMode(try SetModeCommand(from: decoder))
        default:
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "Unknown command type \(type)")
        }
    }
    
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .manual(let cmd):
            try container.encode("manual_command", forKey: .type)
            try cmd.encode(to: encoder)
        case .arm(let cmd):
            try container.encode("arm_command", forKey: .type)
            try cmd.encode(to: encoder)
        case .emergencyStop(let cmd):
            try container.encode("emergency_stop", forKey: .type)
            try cmd.encode(to: encoder)
        case .setMode(let cmd):
            try container.encode("set_mode_command", forKey: .type)
            try cmd.encode(to: encoder)
        }
    }
}

/// Manual real-time flight command (roll, pitch, yaw, throttle).
/// Values are normalized:
/// - Roll, Pitch, Yaw: -1.0 ... 1.0 (0.0 = neutral/level)
/// - Throttle: 0.0 ... 1.0 (0.0 = idle/off, 1.0 = maximum thrust)
public struct ManualFlightCommand: Codable, Sendable, Equatable {
    public let version: Int
    public let type: String
    public let sequence: UInt64
    public let timestampMs: UInt64
    public let roll: Double
    public let pitch: Double
    public let yaw: Double
    public let throttle: Double
    
    enum CodingKeys: String, CodingKey {
        case version
        case type
        case sequence
        case timestampMs = "timestamp_ms"
        case roll
        case pitch
        case yaw
        case throttle
    }
    
    public init(
        version: Int = 1,
        sequence: UInt64,
        timestampMs: UInt64 = UInt64(Date().timeIntervalSince1970 * 1000),
        roll: Double,
        pitch: Double,
        yaw: Double,
        throttle: Double
    ) {
        self.version = version
        self.type = "manual_command"
        self.sequence = sequence
        self.timestampMs = timestampMs
        self.roll = roll
        self.pitch = pitch
        self.yaw = yaw
        self.throttle = throttle
    }
}

/// Explicit arm/disarm command requiring confirmation token.
public struct ArmCommand: Codable, Sendable, Equatable {
    public let version: Int
    public let type: String
    public let sequence: UInt64
    public let timestampMs: UInt64
    public let arm: Bool
    public let confirmationToken: String
    
    enum CodingKeys: String, CodingKey {
        case version
        case type
        case sequence
        case timestampMs = "timestamp_ms"
        case arm
        case confirmationToken = "confirmation_token"
    }
    
    public init(
        version: Int = 1,
        sequence: UInt64,
        timestampMs: UInt64 = UInt64(Date().timeIntervalSince1970 * 1000),
        arm: Bool,
        confirmationToken: String
    ) {
        self.version = version
        self.type = "arm_command"
        self.sequence = sequence
        self.timestampMs = timestampMs
        self.arm = arm
        self.confirmationToken = confirmationToken
    }
}

/// Immediate emergency stop command.
public struct EmergencyStopCommand: Codable, Sendable, Equatable {
    public let version: Int
    public let type: String
    public let sequence: UInt64
    public let timestampMs: UInt64
    
    enum CodingKeys: String, CodingKey {
        case version
        case type
        case sequence
        case timestampMs = "timestamp_ms"
    }
    
    public init(
        version: Int = 1,
        sequence: UInt64,
        timestampMs: UInt64 = UInt64(Date().timeIntervalSince1970 * 1000)
    ) {
        self.version = version
        self.type = "emergency_stop"
        self.sequence = sequence
        self.timestampMs = timestampMs
    }
}

/// Flight mode request command.
public struct SetModeCommand: Codable, Sendable, Equatable {
    public let version: Int
    public let type: String
    public let sequence: UInt64
    public let timestampMs: UInt64
    public let mode: String
    
    enum CodingKeys: String, CodingKey {
        case version
        case type
        case sequence
        case timestampMs = "timestamp_ms"
        case mode
    }
    
    public init(
        version: Int = 1,
        sequence: UInt64,
        timestampMs: UInt64 = UInt64(Date().timeIntervalSince1970 * 1000),
        mode: String
    ) {
        self.version = version
        self.type = "set_mode_command"
        self.sequence = sequence
        self.timestampMs = timestampMs
        self.mode = mode
    }
}
