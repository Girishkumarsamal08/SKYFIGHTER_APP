import Foundation
import Combine

@MainActor
public final class MissionService: ObservableObject {
    @Published public var currentPlan: MissionPlan = MissionPlan()
    @Published public var executionState: MissionExecutionState = .idle
    @Published public var timeline: [MissionTimelineEvent] = []
    @Published public var rejectionReason: String?
    
    public init() {}
    
    /// Starts the autonomous mission, strictly enforcing onboard capability flags and GPS safety requirements.
    public func startMission(telemetry: TelemetryPacket) -> Bool {
        rejectionReason = nil
        
        // 1. Verify onboard capability
        guard telemetry.flight.capabilities.autonomousNavigation else {
            let reason = "Autonomous navigation unavailable — onboard capability not verified."
            rejectionReason = reason
            executionState = .rejectedCapability
            appendEvent(title: "Mission Launch Rejected", detail: reason, severity: .critical)
            return false
        }
        
        // 2. Verify GPS fix
        guard telemetry.gps.valid, telemetry.gps.latitude != nil, telemetry.gps.longitude != nil else {
            let reason = "Safety check failed: No valid GPS 3D fix."
            rejectionReason = reason
            executionState = .rejectedCapability
            appendEvent(title: "Mission Launch Rejected", detail: reason, severity: .warning)
            return false
        }
        
        executionState = .running
        appendEvent(title: "Mission Started", detail: "Executing plan: \(currentPlan.name) (\(currentPlan.type.rawValue))", severity: .info)
        return true
    }
    
    public func pauseMission() {
        guard executionState == .running else { return }
        executionState = .paused
        appendEvent(title: "Mission Paused", detail: "Drone commanded to loiter at current position.", severity: .warning)
    }
    
    public func abortMission() {
        executionState = .aborted
        appendEvent(title: "Mission Aborted", detail: "Autonomous sequence cancelled by pilot.", severity: .critical)
    }
    
    public func commandReturnToHome(telemetry: TelemetryPacket) -> Bool {
        guard telemetry.flight.capabilities.returnToHome else {
            let reason = "Return-to-Home unavailable — onboard capability not verified."
            rejectionReason = reason
            appendEvent(title: "RTH Rejected", detail: reason, severity: .warning)
            return false
        }
        
        executionState = .returningHome
        appendEvent(title: "RTH Commanded", detail: "Drone returning to home coordinates.", severity: .info)
        return true
    }
    
    private func appendEvent(title: String, detail: String, severity: AlertSeverity) {
        let event = MissionTimelineEvent(title: title, detail: detail, severity: severity)
        timeline.insert(event, at: 0)
    }
}
