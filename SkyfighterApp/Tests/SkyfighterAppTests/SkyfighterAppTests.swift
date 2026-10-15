import Testing
import Foundation
@testable import SkyfighterApp

@Suite("Telemetry Parser Tests")
struct TelemetryParserTests {
    let parser = TelemetryParser()
    
    @Test("Parse valid telemetry packet with complete fields")
    func testValidTelemetryParsing() throws {
        let json = """
        {
          "version": 1,
          "type": "telemetry",
          "timestamp_ms": 1700000000000,
          "connection": "connected",
          "flight": {
            "mode": "disarmed",
            "armed": false,
            "capabilities": {
              "manual_control": true,
              "autonomous_navigation": false,
              "return_to_home": false
            }
          },
          "sensors": {
            "temperature_c": 28.5,
            "humidity_pct": 52.0,
            "mq2_adc": 450,
            "flame_detected": false
          },
          "gps": {
            "valid": true,
            "latitude": 12.9716,
            "longitude": 77.5946,
            "satellites": 8,
            "altitude_m": 22.4
          },
          "battery": {
            "voltage_v": null,
            "percentage": null
          },
          "alerts": []
        }
        """.data(using: .utf8)!
        
        let packet = try parser.parse(data: json)
        #expect(packet.version == 1)
        #expect(packet.type == "telemetry")
        #expect(packet.flight.mode == .disarmed)
        #expect(packet.flight.armed == false)
        #expect(packet.flight.capabilities.manualControl == true)
        #expect(packet.flight.capabilities.autonomousNavigation == false)
        #expect(packet.sensors.temperatureC == 28.5)
        #expect(packet.sensors.humidityPct == 52.0)
        #expect(packet.sensors.mq2Adc == 450)
        #expect(packet.sensors.flameDetected == false)
        #expect(packet.gps.valid == true)
        #expect(packet.gps.latitude == 12.9716)
        #expect(packet.battery.voltageV == nil)
    }
    
    @Test("Parse telemetry with null sensor values treating nil as unavailable not zero")
    func testNullSensorValues() throws {
        let json = """
        {
          "version": 1,
          "type": "telemetry",
          "timestamp_ms": 1700000000000,
          "connection": "connected",
          "flight": {
            "mode": "unknown",
            "armed": false,
            "capabilities": {
              "manual_control": false,
              "autonomous_navigation": false,
              "return_to_home": false
            }
          },
          "sensors": {
            "temperature_c": null,
            "humidity_pct": null,
            "mq2_adc": null,
            "flame_detected": null
          },
          "gps": {
            "valid": false,
            "latitude": null,
            "longitude": null
          },
          "battery": {
            "voltage_v": null
          },
          "alerts": []
        }
        """.data(using: .utf8)!
        
        let packet = try parser.parse(data: json)
        #expect(packet.sensors.temperatureC == nil)
        #expect(packet.sensors.humidityPct == nil)
        #expect(packet.sensors.mq2Adc == nil)
        #expect(packet.sensors.flameDetected == nil)
        #expect(packet.gps.valid == false)
        #expect(packet.gps.latitude == nil)
    }
    
    @Test("Reject unsupported schema version")
    func testRejectUnsupportedVersion() {
        let json = """
        {
          "version": 99,
          "type": "telemetry",
          "timestamp_ms": 1700000000000,
          "flight": { "mode": "disarmed", "armed": false, "capabilities": { "manual_control": false, "autonomous_navigation": false, "return_to_home": false } },
          "sensors": {},
          "gps": { "valid": false },
          "battery": {},
          "alerts": []
        }
        """.data(using: .utf8)!
        
        #expect(throws: TelemetryParsingError.self) {
            _ = try parser.parse(data: json)
        }
    }
    
    @Test("Detect stale telemetry based on timestamp")
    func testStaleTelemetryDetection() {
        let veryOldMs: UInt64 = 1000 // In year 1970
        let json = """
        {
          "version": 1,
          "type": "telemetry",
          "timestamp_ms": \(veryOldMs),
          "flight": { "mode": "disarmed", "armed": false, "capabilities": { "manual_control": false, "autonomous_navigation": false, "return_to_home": false } },
          "sensors": {},
          "gps": { "valid": false },
          "battery": {},
          "alerts": []
        }
        """.data(using: .utf8)!
        
        #expect(throws: TelemetryParsingError.self) {
            _ = try parser.parse(data: json, maxAllowedAgeSeconds: 2.0)
        }
    }
}

@Suite("Flight Command Validator Tests")
struct FlightCommandValidatorTests {
    let validator = FlightCommandValidator(maxRateHz: 20.0)
    
    @Test("Sanitize and clamp manual inputs to [-1.0, 1.0]")
    func testClampingRanges() {
        let input = validator.sanitizeInput(
            roll: 2.5,
            pitch: -3.0,
            yaw: 1.5,
            throttle: 1.8,
            isArmed: true,
            deadZone: 0.0
        )
        #expect(input.roll == 1.0)
        #expect(input.pitch == -1.0)
        #expect(input.yaw == 1.0)
        #expect(input.throttle == 1.0)
    }
    
    @Test("Throttle is forced to 0.0 when disarmed")
    func testThrottleZeroWhenDisarmed() {
        let input = validator.sanitizeInput(
            roll: 0.5,
            pitch: 0.2,
            yaw: 0.0,
            throttle: 0.85,
            isArmed: false,
            deadZone: 0.0
        )
        #expect(input.throttle == 0.0)
    }
    
    @Test("Deadzone cancels small stick drift")
    func testDeadzoneThreshold() {
        let input = validator.sanitizeInput(
            roll: 0.03,
            pitch: -0.04,
            yaw: 0.02,
            throttle: 0.0,
            isArmed: true,
            deadZone: 0.05
        )
        #expect(input.roll == 0.0)
        #expect(input.pitch == 0.0)
        #expect(input.yaw == 0.0)
    }
    
    @Test("Emergency stop command creates valid payload")
    func testEmergencyStopCreation() {
        let cmd = validator.createEmergencyStopCommand()
        #expect(cmd.type == "emergency_stop")
        #expect(cmd.sequence > 0)
    }
    
    @Test("Arm command includes verification token")
    func testArmCommandCreation() {
        let token = "SAFE-TOKEN-123"
        let cmd = validator.createArmCommand(arm: true, confirmationToken: token)
        #expect(cmd.type == "arm_command")
        #expect(cmd.arm == true)
        #expect(cmd.confirmationToken == token)
    }
}

@Suite("Fire Hazard Evaluation Tests")
struct FireHazardEvaluationTests {
    @Test("Evaluate Multi-Sensor Alert on flame plus high temp")
    @MainActor
    func testMultiSensorAlert() {
        let service = FireMonitoringService()
        let packet = TelemetryPacket(
            sensors: SensorTelemetry(
                temperatureC: 55.0,
                humidityPct: 20.0,
                mq2Adc: 1800,
                flameDetected: true
            )
        )
        service.evaluateTelemetry(packet: packet, isConnected: true, isStale: false)
        #expect(service.currentState == .multiSensorAlert)
        #expect(service.eventHistory.count == 1)
    }
    
    @Test("Evaluate Flame Detected state on flame sensor only")
    @MainActor
    func testSingleFlameSensor() {
        let service = FireMonitoringService()
        let packet = TelemetryPacket(
            sensors: SensorTelemetry(
                temperatureC: 25.0,
                humidityPct: 50.0,
                mq2Adc: 400,
                flameDetected: true
            )
        )
        service.evaluateTelemetry(packet: packet, isConnected: true, isStale: false)
        #expect(service.currentState == .flameDetected)
    }
    
    @Test("Evaluate Communication Lost when disconnected")
    @MainActor
    func testCommsLost() {
        let service = FireMonitoringService()
        let packet = TelemetryPacket()
        service.evaluateTelemetry(packet: packet, isConnected: false, isStale: false)
        #expect(service.currentState == .communicationLost)
    }
}

@Suite("Mission Capability Safety Tests")
struct MissionCapabilitySafetyTests {
    @Test("Reject mission start if autonomous navigation capability is false")
    @MainActor
    func testRejectMissionWithoutCapability() {
        let service = MissionService()
        let packet = TelemetryPacket(
            flight: FlightTelemetry(
                capabilities: FlightCapabilities(
                    manualControl: true,
                    autonomousNavigation: false // FIRMWARE REPORTS FALSE
                )
            ),
            gps: GPSTelemetry(valid: true, latitude: 12.9716, longitude: 77.5946)
        )
        
        let started = service.startMission(telemetry: packet)
        #expect(started == false)
        #expect(service.executionState == .rejectedCapability)
        #expect(service.rejectionReason?.contains("Autonomous navigation unavailable") == true)
    }
    
    @Test("Reject mission start if GPS fix is invalid")
    @MainActor
    func testRejectMissionWithoutGPSFix() {
        let service = MissionService()
        let packet = TelemetryPacket(
            flight: FlightTelemetry(
                capabilities: FlightCapabilities(
                    manualControl: true,
                    autonomousNavigation: true
                )
            ),
            gps: GPSTelemetry(valid: false, latitude: nil, longitude: nil)
        )
        
        let started = service.startMission(telemetry: packet)
        #expect(started == false)
        #expect(service.executionState == .rejectedCapability)
    }
}
