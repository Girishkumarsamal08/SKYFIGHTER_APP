import Foundation

/// Safe mock telemetry provider and simulated transport for UI testing and demonstration.
/// Does not require real hardware and will never command physical motors.
public final class MockDroneTransport: DroneTransport, @unchecked Sendable {
    public weak var delegate: (any DroneTransportDelegate)?
    public private(set) var isConnected: Bool = false
    public let transportName: String = "Simulation Mode (Safe Mock)"
    
    // Configurable simulation states
    public var simulateFlame: Bool = false
    public var simulateSmoke: Bool = false
    public var simulateGPSLoss: Bool = false
    public var simulateAutonomousCapability: Bool = false
    public var simulateArmed: Bool = false
    
    private var timer: Timer?
    private var sequence: UInt64 = 0
    private var lat: Double = 12.9716 // Demo coordinates
    private var lon: Double = 77.5946
    private let lock = NSLock()
    
    public init() {}
    
    public func connect(config: ConnectionConfig) async throws {
        setIsConnected(true)
        
        delegate?.transportDidConnect(transportName: transportName)
        
        // Start 2Hz simulated telemetry stream
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.timer?.invalidate()
            self.timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
                self?.broadcastMockTelemetry()
            }
        }
    }
    
    public func disconnect() async {
        setIsConnected(false)
        
        DispatchQueue.main.async { [weak self] in
            self?.timer?.invalidate()
            self?.timer = nil
        }
        
        delegate?.transportDidDisconnect(error: nil)
    }
    
    public func send(data: Data) async throws {
        guard isConnected else {
            throw NSError(domain: "MockTransport", code: -1, userInfo: [NSLocalizedDescriptionKey: "Simulation is disconnected."])
        }
        
        // Parse incoming command and update simulation state accordingly
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let type = json["type"] as? String {
            if type == "arm_command", let arm = json["arm"] as? Bool {
                setSimulateArmed(arm)
            }
        }
    }
    
    private func setIsConnected(_ value: Bool) {
        lock.lock()
        defer { lock.unlock() }
        isConnected = value
    }
    
    private func setSimulateArmed(_ value: Bool) {
        lock.lock()
        defer { lock.unlock() }
        simulateArmed = value
    }
    
    private func broadcastMockTelemetry() {
        guard isConnected else { return }
        sequence += 1
        let nowMs = UInt64(Date().timeIntervalSince1970 * 1000)
        
        // Small random jitter on sensor readings
        let baseTemp = simulateFlame ? 62.5 : 28.4 + Double.random(in: -0.2...0.2)
        let baseHumidity = simulateFlame ? 22.0 : 54.0 + Double.random(in: -0.5...0.5)
        let baseMq2 = simulateSmoke ? 2300 : (simulateFlame ? 1850 : 420 + Int.random(in: -10...10))
        
        var alerts: [TelemetryAlert] = []
        if simulateFlame {
            alerts.append(TelemetryAlert(
                code: "FLAME_DETECTED",
                severity: .critical,
                source: "Digital Flame Sensor",
                message: "Active flame detected on optical IR sensor!",
                timestampMs: nowMs
            ))
        }
        if simulateSmoke {
            alerts.append(TelemetryAlert(
                code: "SMOKE_HIGH",
                severity: .warning,
                source: "MQ-2 Gas Sensor",
                message: "Elevated smoke/combustion gas reading.",
                timestampMs: nowMs
            ))
        }
        
        let packet = TelemetryPacket(
            version: 1,
            type: "telemetry",
            timestampMs: nowMs,
            connection: "connected",
            flight: FlightTelemetry(
                mode: simulateArmed ? .manual : .disarmed,
                armed: simulateArmed,
                capabilities: FlightCapabilities(
                    manualControl: true,
                    autonomousNavigation: simulateAutonomousCapability,
                    returnToHome: false
                )
            ),
            sensors: SensorTelemetry(
                temperatureC: baseTemp,
                humidityPct: baseHumidity,
                mq2Adc: baseMq2,
                flameDetected: simulateFlame,
                mpuConnected: true,
                mpuTemperatureC: 32.1
            ),
            gps: GPSTelemetry(
                valid: !simulateGPSLoss,
                latitude: simulateGPSLoss ? nil : lat + Double(sequence % 100) * 0.00001,
                longitude: simulateGPSLoss ? nil : lon + Double(sequence % 100) * 0.00001,
                satellites: simulateGPSLoss ? 0 : 9,
                altitudeM: simulateGPSLoss ? nil : 18.5
            ),
            battery: BatteryTelemetry(
                voltageV: nil, // Battery telemetry explicitly unavailable on current prototype
                percentage: nil
            ),
            alerts: alerts
        )
        
        if let encoded = try? JSONEncoder().encode(packet) {
            delegate?.transportDidReceiveData(encoded)
        }
    }
}
