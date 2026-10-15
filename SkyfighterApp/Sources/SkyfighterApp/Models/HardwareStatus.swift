import Foundation

public enum FeatureImplementationState: String, CaseIterable, Sendable {
    case verifiedImplemented = "Verified in Firmware"
    case bridgeInProgress = "Bridge Gateway in Progress"
    case plannedUnverified = "Planned (Hardware Not Ready)"
    case unavailable = "Sensor Absent"
}

public struct HardwareComponentStatus: Identifiable, Sendable {
    public let id: String
    public let componentName: String
    public let hardwareTarget: String
    public let state: FeatureImplementationState
    public let description: String
    
    public init(id: String, componentName: String, hardwareTarget: String, state: FeatureImplementationState, description: String) {
        self.id = id
        self.componentName = componentName
        self.hardwareTarget = hardwareTarget
        self.state = state
        self.description = description
    }
}

public enum HardwareManifest {
    public static let components: [HardwareComponentStatus] = [
        HardwareComponentStatus(
            id: "dht11",
            componentName: "DHT11 Sensor",
            hardwareTarget: "ESP32 #1 (GPIO 4)",
            state: .verifiedImplemented,
            description: "Ambient temperature and relative humidity sensing implemented in sketch.ino."
        ),
        HardwareComponentStatus(
            id: "flame",
            componentName: "Digital Flame Sensor",
            hardwareTarget: "ESP32 #1 (GPIO 27)",
            state: .verifiedImplemented,
            description: "Infrared fire detection implemented with active-low trigger logic."
        ),
        HardwareComponentStatus(
            id: "mq2",
            componentName: "MQ-2 Gas / Smoke Sensor",
            hardwareTarget: "ESP32 #1 (GPIO 34)",
            state: .verifiedImplemented,
            description: "ADC smoke reading with baseline calibration threshold logic."
        ),
        HardwareComponentStatus(
            id: "mpu6050",
            componentName: "MPU6050 6-DoF IMU",
            hardwareTarget: "ESP32 #1 (I2C 0x68)",
            state: .verifiedImplemented,
            description: "Accelerometer and gyroscope readouts implemented via Wire.h."
        ),
        HardwareComponentStatus(
            id: "gps",
            componentName: "NEO-6M GPS Module",
            hardwareTarget: "ESP32 #1 (UART2 GPIO 16/17)",
            state: .verifiedImplemented,
            description: "NMEA sentence parser reading lat/lon coordinates."
        ),
        HardwareComponentStatus(
            id: "buzzer",
            componentName: "Local Alert Buzzer",
            hardwareTarget: "ESP32 #1 (GPIO 26)",
            state: .verifiedImplemented,
            description: "Audible alarm triggered on smoke, flame, or thermal warnings."
        ),
        HardwareComponentStatus(
            id: "wifi_gateway",
            componentName: "ESP32 #2 Wi-Fi Gateway",
            hardwareTarget: "ESP32 Dev Module #2",
            state: .bridgeInProgress,
            description: "SoftAP Wi-Fi endpoint, JSON command validation and UART forwarding to ESP32 #1."
        ),
        HardwareComponentStatus(
            id: "motor_mixing",
            componentName: "4x A2212 Brushless Motors + ESCs",
            hardwareTarget: "ESP32 #1 (PWM DShot/OneShot)",
            state: .plannedUnverified,
            description: "Flight PID stabilization and motor control not yet active in current firmware."
        ),
        HardwareComponentStatus(
            id: "battery_telemetry",
            componentName: "LiPo Voltage Divider",
            hardwareTarget: "ESP32 #1 (ADC Pin)",
            state: .unavailable,
            description: "Voltage divider resistor bridge not wired; reports unavailable."
        ),
        HardwareComponentStatus(
            id: "autonomous_nav",
            componentName: "Autonomous Waypoint Navigation",
            hardwareTarget: "Firmware Algorithm",
            state: .plannedUnverified,
            description: "Onboard autopilot capability unverified; app enforces safety lockout."
        )
    ]
}
