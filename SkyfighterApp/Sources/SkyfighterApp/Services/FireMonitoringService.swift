import Foundation
import Combine
import AVFoundation

public enum FireAlertState: String, CaseIterable, Sendable {
    case normal = "NORMAL"
    case possibleSmoke = "POSSIBLE SMOKE"
    case flameDetected = "FLAME DETECTED"
    case highTemperature = "HIGH TEMPERATURE"
    case multiSensorAlert = "MULTI-SENSOR ALERT"
    case sensorError = "SENSOR ERROR"
    case communicationLost = "COMMUNICATION LOST"
    
    public var severity: AlertSeverity {
        switch self {
        case .normal: return .info
        case .possibleSmoke, .highTemperature: return .warning
        case .flameDetected, .multiSensorAlert, .communicationLost: return .critical
        case .sensorError: return .warning
        }
    }
    
    public var icon: String {
        switch self {
        case .normal: return "checkmark.shield.fill"
        case .possibleSmoke: return "smoke.fill"
        case .flameDetected: return "flame.fill"
        case .highTemperature: return "thermometer.sun.fill"
        case .multiSensorAlert: return "exclamationmark.triangle.fill"
        case .sensorError: return "sensor.tag.radiowaves.forward.fill"
        case .communicationLost: return "antenna.radiowaves.left.and.right.slash"
        }
    }
}

public struct FireEventRecord: Identifiable, Sendable {
    public let id: UUID
    public let timestamp: Date
    public let state: FireAlertState
    public let temperatureC: Double?
    public let humidityPct: Double?
    public let mq2Adc: Int?
    public let latitude: Double?
    public let longitude: Double?
    public var isAcknowledged: Bool
    
    public init(
        id: UUID = UUID(),
        timestamp: Date = Date(),
        state: FireAlertState,
        temperatureC: Double? = nil,
        humidityPct: Double? = nil,
        mq2Adc: Int? = nil,
        latitude: Double? = nil,
        longitude: Double? = nil,
        isAcknowledged: Bool = false
    ) {
        self.id = id
        self.timestamp = timestamp
        self.state = state
        self.temperatureC = temperatureC
        self.humidityPct = humidityPct
        self.mq2Adc = mq2Adc
        self.latitude = latitude
        self.longitude = longitude
        self.isAcknowledged = isAcknowledged
    }
}

@MainActor
public final class FireMonitoringService: ObservableObject {
    @Published public var currentState: FireAlertState = .normal
    @Published public var eventHistory: [FireEventRecord] = []
    @Published public var audioAlertsEnabled: Bool = true
    @Published public var smokeThresholdAdc: Int = 1200
    @Published public var temperatureThresholdC: Double = 48.0
    
    private var lastRecordedState: FireAlertState = .normal
    private var audioPlayer: AVAudioPlayer?
    
    public init() {}
    
    /// Evaluates incoming telemetry packet and determines composite fire alert status.
    public func evaluateTelemetry(packet: TelemetryPacket, isConnected: Bool, isStale: Bool) {
        guard isConnected && !isStale else {
            updateState(.communicationLost, packet: packet)
            return
        }
        
        let sensors = packet.sensors
        let hasFlame = sensors.flameDetected == true
        let hasTemp = sensors.temperatureC != nil
        let tempVal = sensors.temperatureC ?? 0.0
        let hasSmoke = (sensors.mq2Adc ?? 0) >= smokeThresholdAdc
        let isHighTemp = hasTemp && tempVal >= temperatureThresholdC
        
        // Sensor health verification: If primary sensors return nil, flag sensor error
        if sensors.flameDetected == nil && sensors.temperatureC == nil && sensors.mq2Adc == nil {
            updateState(.sensorError, packet: packet)
            return
        }
        
        // Multi-sensor correlation: Flame + Smoke OR Flame + High Temp
        if hasFlame && (hasSmoke || isHighTemp) {
            updateState(.multiSensorAlert, packet: packet)
        } else if hasFlame {
            updateState(.flameDetected, packet: packet)
        } else if isHighTemp {
            updateState(.highTemperature, packet: packet)
        } else if hasSmoke {
            updateState(.possibleSmoke, packet: packet)
        } else {
            updateState(.normal, packet: packet)
        }
    }
    
    public func acknowledgeEvent(id: UUID) {
        if let idx = eventHistory.firstIndex(where: { $0.id == id }) {
            eventHistory[idx].isAcknowledged = true
        }
    }
    
    private func updateState(_ newState: FireAlertState, packet: TelemetryPacket) {
        let changed = newState != currentState
        currentState = newState
        
        if changed && newState != .normal {
            let record = FireEventRecord(
                state: newState,
                temperatureC: packet.sensors.temperatureC,
                humidityPct: packet.sensors.humidityPct,
                mq2Adc: packet.sensors.mq2Adc,
                latitude: packet.gps.valid ? packet.gps.latitude : nil,
                longitude: packet.gps.valid ? packet.gps.longitude : nil
            )
            eventHistory.insert(record, at: 0)
            
            if audioAlertsEnabled && (newState == .flameDetected || newState == .multiSensorAlert) {
                triggerAudioAlert()
            }
        }
        lastRecordedState = newState
    }
    
    private func triggerAudioAlert() {
        // Play system warning alert tone or custom sound
        AudioServicesPlayAlertSound(SystemSoundID(1005))
    }
}
