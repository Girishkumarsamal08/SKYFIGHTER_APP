import Foundation
import Combine

@MainActor
public final class DroneConnectionManager: ObservableObject, DroneTransportDelegate {
    @Published public var config: ConnectionConfig
    @Published public var status: ConnectionStatus = .disconnected
    @Published public var telemetry: TelemetryPacket = .init()
    @Published public var lastTelemetryDate: Date?
    @Published public var isTelemetryStale: Bool = false
    @Published public var latencyMs: Double = 0.0
    @Published public var packetCount: Int = 0
    @Published public var lastErrorMessage: String?
    
    public let commandValidator = FlightCommandValidator()
    private let parser = TelemetryParser()
    private var activeTransport: (any DroneTransport)?
    private var freshnessTimer: Timer?
    private var lastSequence: UInt64 = 0
    
    public init(config: ConnectionConfig = ConnectionConfig()) {
        self.config = config
    }
    
    public func updateTransportMode(_ mode: TransportMode) {
        config.transportMode = mode
        if status.isConnected {
            Task {
                await disconnect()
                await connect()
            }
        }
    }
    
    public func connect() async {
        status = .connecting("\(config.host):\(config.port)")
        lastErrorMessage = nil
        
        let transport: any DroneTransport
        switch config.transportMode {
        case .webSocket:
            transport = WiFiWebSocketTransport()
        case .tcpSocket:
            transport = WiFiTCPTransport()
        case .mockSimulation:
            transport = MockDroneTransport()
        }
        
        transport.delegate = self
        self.activeTransport = transport
        
        do {
            try await transport.connect(config: config)
            startFreshnessMonitor()
        } catch {
            status = .failed(reason: error.localizedDescription)
            lastErrorMessage = error.localizedDescription
        }
    }
    
    public func disconnect() async {
        freshnessTimer?.invalidate()
        freshnessTimer = nil
        
        await activeTransport?.disconnect()
        activeTransport = nil
        status = .disconnected
        isTelemetryStale = false
    }
    
    public func sendManualFlight(input: ValidatedFlightInput) async throws {
        guard status.isConnected else { return }
        
        // Only allow manual commands if drone firmware capability reports manualControl == true
        // (or in simulation mode)
        guard telemetry.flight.capabilities.manualControl || config.transportMode == .mockSimulation else {
            throw NSError(domain: "Skyfighter", code: 403, userInfo: [NSLocalizedDescriptionKey: "Manual control rejected: Onboard capability not verified by firmware."])
        }
        
        guard let command = commandValidator.createManualCommand(input: input) else {
            return // Rate limited
        }
        
        let data = try JSONEncoder().encode(command)
        try await activeTransport?.send(data: data)
    }
    
    public func sendArming(arm: Bool, confirmationToken: String) async throws {
        guard status.isConnected else { return }
        
        let command = commandValidator.createArmCommand(arm: arm, confirmationToken: confirmationToken)
        let data = try JSONEncoder().encode(command)
        try await activeTransport?.send(data: data)
    }
    
    public func sendEmergencyStop() async throws {
        guard status.isConnected else { return }
        
        let command = commandValidator.createEmergencyStopCommand()
        let data = try JSONEncoder().encode(command)
        try await activeTransport?.send(data: data)
    }
    
    // MARK: - DroneTransportDelegate
    
    nonisolated public func transportDidConnect(transportName: String) {
        Task { @MainActor in
            self.status = .connected(transport: transportName, latencyMs: self.latencyMs)
        }
    }
    
    nonisolated public func transportDidDisconnect(error: Error?) {
        Task { @MainActor in
            self.freshnessTimer?.invalidate()
            self.freshnessTimer = nil
            if let error = error {
                self.status = .connectionLost(reason: error.localizedDescription)
                self.lastErrorMessage = error.localizedDescription
            } else {
                self.status = .disconnected
            }
        }
    }
    
    nonisolated public func transportDidReceiveData(_ data: Data) {
        Task { @MainActor in
            do {
                let packet = try self.parser.parse(data: data)
                self.packetCount += 1
                self.telemetry = packet
                self.lastTelemetryDate = Date()
                self.isTelemetryStale = false
                
                // Calculate estimated latency if timestamp is present
                if packet.timestampMs > 0 {
                    let nowMs = UInt64(Date().timeIntervalSince1970 * 1000)
                    if nowMs >= packet.timestampMs {
                        self.latencyMs = Double(nowMs - packet.timestampMs)
                    }
                }
                
                if case .connected(let tr, _) = self.status {
                    self.status = .connected(transport: tr, latencyMs: self.latencyMs)
                }
            } catch {
                // Ignore corrupted individual frame or log error
            }
        }
    }
    
    private func startFreshnessMonitor() {
        freshnessTimer?.invalidate()
        freshnessTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                guard let last = self.lastTelemetryDate else { return }
                
                let elapsed = Date().timeIntervalSince(last)
                if elapsed > self.config.telemetryTimeoutSeconds {
                    if !self.isTelemetryStale {
                        self.isTelemetryStale = true
                    }
                }
            }
        }
    }
}
