import Foundation

/// Represents the top-level telemetry packet received from the drone (ESP32 #2 -> iPhone).
/// Uses versioning and explicitly treats `nil` as unavailable data, not 0.
public struct TelemetryPacket: Codable, Sendable, Equatable {
    public let version: Int
    public let type: String
    public let timestampMs: UInt64
    public let connection: String?
    public let flight: FlightTelemetry
    public let sensors: SensorTelemetry
    public let gps: GPSTelemetry
    public let battery: BatteryTelemetry
    public let alerts: [TelemetryAlert]
    
    enum CodingKeys: String, CodingKey {
        case version
        case type
        case timestampMs = "timestamp_ms"
        case connection
        case flight
        case sensors
        case gps
        case battery
        case alerts
    }
    
    public init(
        version: Int = 1,
        type: String = "telemetry",
        timestampMs: UInt64 = 0,
        connection: String? = "connected",
        flight: FlightTelemetry = .init(),
        sensors: SensorTelemetry = .init(),
        gps: GPSTelemetry = .init(),
        battery: BatteryTelemetry = .init(),
        alerts: [TelemetryAlert] = []
    ) {
        self.version = version
        self.type = type
        self.timestampMs = timestampMs
        self.connection = connection
        self.flight = flight
        self.sensors = sensors
        self.gps = gps
        self.battery = battery
        self.alerts = alerts
    }
}

/// Flight status and verified onboard firmware capabilities.
public struct FlightTelemetry: Codable, Sendable, Equatable {
    public let mode: FlightMode
    public let armed: Bool
    public let capabilities: FlightCapabilities
    
    public init(
        mode: FlightMode = .disarmed,
        armed: Bool = false,
        capabilities: FlightCapabilities = .init()
    ) {
        self.mode = mode
        self.armed = armed
        self.capabilities = capabilities
    }
}

public enum FlightMode: String, Codable, Sendable {
    case disarmed
    case manual
    case autonomous
    case failsafe
    case unknown
    
    public var displayName: String {
        switch self {
        case .disarmed: return "Disarmed"
        case .manual: return "Manual Flight"
        case .autonomous: return "Autonomous"
        case .failsafe: return "Failsafe Active"
        case .unknown: return "Unknown Mode"
        }
    }
}

/// Onboard firmware capabilities reported by ESP32 #1.
/// The iOS app NEVER assumes a capability exists unless the firmware explicitly flags it true.
public struct FlightCapabilities: Codable, Sendable, Equatable {
    public let manualControl: Bool
    public let autonomousNavigation: Bool
    public let returnToHome: Bool
    
    enum CodingKeys: String, CodingKey {
        case manualControl = "manual_control"
        case autonomousNavigation = "autonomous_navigation"
        case returnToHome = "return_to_home"
    }
    
    public init(
        manualControl: Bool = false,
        autonomousNavigation: Bool = false,
        returnToHome: Bool = false
    ) {
        self.manualControl = manualControl
        self.autonomousNavigation = autonomousNavigation
        self.returnToHome = returnToHome
    }
}

/// Environmental sensors (DHT11, MQ-2, Digital Flame Sensor).
/// All numeric values are Optional to distinguish "zero reading" from "hardware disconnected/unavailable".
public struct SensorTelemetry: Codable, Sendable, Equatable {
    public let temperatureC: Double?
    public let humidityPct: Double?
    public let mq2Adc: Int?
    public let flameDetected: Bool?
    public let mpuConnected: Bool?
    public let mpuTemperatureC: Double?
    
    enum CodingKeys: String, CodingKey {
        case temperatureC = "temperature_c"
        case humidityPct = "humidity_pct"
        case mq2Adc = "mq2_adc"
        case flameDetected = "flame_detected"
        case mpuConnected = "mpu_connected"
        case mpuTemperatureC = "mpu_temperature_c"
    }
    
    public init(
        temperatureC: Double? = nil,
        humidityPct: Double? = nil,
        mq2Adc: Int? = nil,
        flameDetected: Bool? = nil,
        mpuConnected: Bool? = nil,
        mpuTemperatureC: Double? = nil
    ) {
        self.temperatureC = temperatureC
        self.humidityPct = humidityPct
        self.mq2Adc = mq2Adc
        self.flameDetected = flameDetected
        self.mpuConnected = mpuConnected
        self.mpuTemperatureC = mpuTemperatureC
    }
}

/// GPS information from NEO-6M module on ESP32 #1.
public struct GPSTelemetry: Codable, Sendable, Equatable {
    public let valid: Bool
    public let latitude: Double?
    public let longitude: Double?
    public let satellites: Int?
    public let altitudeM: Double?
    
    enum CodingKeys: String, CodingKey {
        case valid
        case latitude
        case longitude
        case satellites
        case altitudeM = "altitude_m"
    }
    
    public init(
        valid: Bool = false,
        latitude: Double? = nil,
        longitude: Double? = nil,
        satellites: Int? = nil,
        altitudeM: Double? = nil
    ) {
        self.valid = valid
        self.latitude = latitude
        self.longitude = longitude
        self.satellites = satellites
        self.altitudeM = altitudeM
    }
}

/// Battery voltage and telemetry.
/// Only displays percentage/voltage when real battery sensor is present.
public struct BatteryTelemetry: Codable, Sendable, Equatable {
    public let voltageV: Double?
    public let percentage: Int?
    
    enum CodingKeys: String, CodingKey {
        case voltageV = "voltage_v"
        case percentage
    }
    
    public init(voltageV: Double? = nil, percentage: Int? = nil) {
        self.voltageV = voltageV
        self.percentage = percentage
    }
}

/// Discrete alert item reported directly by drone firmware.
public struct TelemetryAlert: Codable, Sendable, Equatable, Identifiable {
    public var id: String { "\(source)_\(timestampMs)_\(code)" }
    public let code: String
    public let severity: AlertSeverity
    public let source: String
    public let message: String
    public let timestampMs: UInt64
    
    enum CodingKeys: String, CodingKey {
        case code
        case severity
        case source
        case message
        case timestampMs = "timestamp_ms"
    }
    
    public init(
        code: String,
        severity: AlertSeverity,
        source: String,
        message: String,
        timestampMs: UInt64 = 0
    ) {
        self.code = code
        self.severity = severity
        self.source = source
        self.message = message
        self.timestampMs = timestampMs
    }
}

public enum AlertSeverity: String, Codable, Sendable {
    case info
    case warning
    case critical
}
