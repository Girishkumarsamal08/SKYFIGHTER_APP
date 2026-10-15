import Foundation

public enum TransportMode: String, CaseIterable, Codable, Sendable {
    case webSocket = "WebSocket (ws://)"
    case tcpSocket = "Raw TCP (Network.framework)"
    case mockSimulation = "Simulation / Test Mode"
}

public enum ConnectionStatus: Equatable, Sendable {
    case disconnected
    case connecting(String)
    case connected(transport: String, latencyMs: Double)
    case connectionLost(reason: String)
    case failed(reason: String)
    
    public var isConnected: Bool {
        if case .connected = self { return true }
        return false
    }
    
    public var displayText: String {
        switch self {
        case .disconnected:
            return "Disconnected"
        case .connecting(let target):
            return "Connecting to \(target)..."
        case .connected(let transport, let latency):
            return "Connected (\(transport), \(Int(latency))ms)"
        case .connectionLost(let reason):
            return "Connection Lost: \(reason)"
        case .failed(let reason):
            return "Error: \(reason)"
        }
    }
}

public struct ConnectionConfig: Codable, Sendable, Equatable {
    public var ssid: String
    public var host: String
    public var port: Int
    public var transportMode: TransportMode
    public var autoReconnect: Bool
    public var heartbeatIntervalSeconds: Double
    public var commandRateLimitHz: Double
    public var telemetryTimeoutSeconds: Double
    
    public init(
        ssid: String = "SKYFIGHTER_GATEWAY",
        host: String = "192.168.4.1",
        port: Int = 8080,
        transportMode: TransportMode = .webSocket,
        autoReconnect: Bool = true,
        heartbeatIntervalSeconds: Double = 1.0,
        commandRateLimitHz: Double = 20.0,
        telemetryTimeoutSeconds: Double = 2.5
    ) {
        self.ssid = ssid
        self.host = host
        self.port = port
        self.transportMode = transportMode
        self.autoReconnect = autoReconnect
        self.heartbeatIntervalSeconds = heartbeatIntervalSeconds
        self.commandRateLimitHz = commandRateLimitHz
        self.telemetryTimeoutSeconds = telemetryTimeoutSeconds
    }
}
