import SwiftUI

public struct MissionView: View {
    @ObservedObject public var missionService: MissionService
    @ObservedObject public var connectionManager: DroneConnectionManager
    
    public init(missionService: MissionService, connectionManager: DroneConnectionManager) {
        self.missionService = missionService
        self.connectionManager = connectionManager
    }
    
    private var telemetry: TelemetryPacket {
        connectionManager.telemetry
    }
    
    private var hasAutonomousCapability: Bool {
        telemetry.flight.capabilities.autonomousNavigation
    }
    
    public var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Header Bar
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("AUTONOMOUS MISSIONS")
                            .font(.system(size: 20, weight: .black, design: .monospaced))
                            .foregroundColor(SkyTheme.textPrimary)
                        Text("Flight Route & Environmental Surveys")
                            .font(.system(size: 11))
                            .foregroundColor(SkyTheme.textSecondary)
                    }
                    Spacer()
                    StatusBadge(
                        text: missionService.executionState.rawValue.uppercased(),
                        icon: "airplane.circle",
                        color: missionService.executionState == .running ? SkyTheme.normalGreen : (missionService.executionState == .rejectedCapability ? SkyTheme.criticalRed : SkyTheme.accentCyan)
                    )
                }
                .padding(.top, 4)
                
                // CRITICAL REQUIREMENT: Capability Lockout Banner if firmware does not support autonomous navigation
                if !hasAutonomousCapability {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 8) {
                            Image(systemName: "exclamationmark.octagon.fill")
                                .font(.headline)
                                .foregroundColor(SkyTheme.criticalRed)
                            Text("Capability Lockout")
                                .font(.subheadline.bold())
                                .foregroundColor(SkyTheme.criticalRed)
                        }
                        Text("Autonomous navigation unavailable — onboard capability not verified.")
                            .font(.footnote.bold())
                            .foregroundColor(SkyTheme.textPrimary)
                        Text("ESP32 #1 firmware currently implements sensor monitoring only. Autopilot waypoint navigation cannot be commanded until flight control software is compiled and verified.")
                            .font(.caption2)
                            .foregroundColor(SkyTheme.textSecondary)
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(SkyTheme.criticalRed.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(SkyTheme.criticalRed.opacity(0.4), lineWidth: 1)
                    )
                }
                
                // Mission Plan Configuration
                VStack(alignment: .leading, spacing: 12) {
                    Text("MISSION CONFIGURATION")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundColor(SkyTheme.textSecondary)
                    
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Mission Name")
                            .font(.caption)
                            .foregroundColor(SkyTheme.textMuted)
                        TextField("Mission Name", text: $missionService.currentPlan.name)
                            .padding(10)
                            .background(SkyTheme.panelSecondary)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .foregroundColor(SkyTheme.textPrimary)
                    }
                    
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Mission Type")
                            .font(.caption)
                            .foregroundColor(SkyTheme.textMuted)
                        Picker("Type", selection: $missionService.currentPlan.type) {
                            ForEach(MissionType.allCases, id: \.self) { type in
                                Label(type.rawValue, systemImage: type.icon).tag(type)
                            }
                        }
                        .pickerStyle(.menu)
                        .tint(SkyTheme.accentCyan)
                    }
                    
                    Text(missionService.currentPlan.type.description)
                        .font(.caption2)
                        .foregroundColor(SkyTheme.textSecondary)
                }
                .skyPanel()
                
                // Mission Actions Bar
                HStack(spacing: 12) {
                    // Start Button
                    Button(action: {
                        _ = missionService.startMission(telemetry: telemetry)
                    }) {
                        HStack(spacing: 6) {
                            Image(systemName: "play.fill")
                            Text("START")
                                .font(.caption.bold())
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(hasAutonomousCapability ? SkyTheme.normalGreen : SkyTheme.panelSecondary)
                        .foregroundColor(hasAutonomousCapability ? .white : SkyTheme.textMuted)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .disabled(!hasAutonomousCapability || missionService.executionState == .running)
                    
                    // Pause Button
                    Button(action: {
                        missionService.pauseMission()
                    }) {
                        HStack(spacing: 6) {
                            Image(systemName: "pause.fill")
                            Text("PAUSE")
                                .font(.caption.bold())
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(missionService.executionState == .running ? SkyTheme.warningAmber : SkyTheme.panelSecondary)
                        .foregroundColor(missionService.executionState == .running ? .black : SkyTheme.textMuted)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .disabled(missionService.executionState != .running)
                    
                    // Abort Button
                    Button(action: {
                        missionService.abortMission()
                    }) {
                        HStack(spacing: 6) {
                            Image(systemName: "xmark.circle.fill")
                            Text("ABORT")
                                .font(.caption.bold())
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(SkyTheme.criticalRed)
                        .foregroundColor(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                }
                
                // Return-to-Home Action Bar
                Button(action: {
                    _ = missionService.commandReturnToHome(telemetry: telemetry)
                }) {
                    HStack {
                        Image(systemName: "house.fill")
                        Text("COMMAND RETURN-TO-HOME (RTH)")
                            .font(.subheadline.bold())
                        Spacer()
                        Image(systemName: "chevron.right")
                    }
                    .padding(14)
                    .background(telemetry.flight.capabilities.returnToHome ? SkyTheme.accentCyan.opacity(0.2) : SkyTheme.panelBackground)
                    .foregroundColor(telemetry.flight.capabilities.returnToHome ? SkyTheme.accentCyan : SkyTheme.textMuted)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(SkyTheme.panelBorder, lineWidth: 1)
                    )
                }
                .disabled(!telemetry.flight.capabilities.returnToHome)
                
                // Safety Preflight Status Grid
                VStack(alignment: .leading, spacing: 10) {
                    Text("AUTONOMOUS PREFLIGHT AUDIT")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundColor(SkyTheme.textSecondary)
                    
                    HStack(spacing: 8) {
                        CheckBadge(title: "GPS 3D Fix", passed: telemetry.gps.valid)
                        CheckBadge(title: "IMU Active", passed: telemetry.sensors.mpuConnected ?? false)
                        CheckBadge(title: "Onboard Auto", passed: hasAutonomousCapability)
                    }
                }
                .skyPanel()
                
                // Mission Event Timeline
                VStack(alignment: .leading, spacing: 10) {
                    Text("MISSION TIMELINE & EVENT LOG")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundColor(SkyTheme.textSecondary)
                    
                    if missionService.timeline.isEmpty {
                        Text("No mission events recorded yet.")
                            .font(.caption)
                            .foregroundColor(SkyTheme.textMuted)
                            .padding(.vertical, 8)
                    } else {
                        ForEach(missionService.timeline) { event in
                            HStack(alignment: .top, spacing: 10) {
                                Circle()
                                    .fill(event.severity == .critical ? SkyTheme.criticalRed : (event.severity == .warning ? SkyTheme.warningAmber : SkyTheme.accentCyan))
                                    .frame(width: 8, height: 8)
                                    .padding(.top, 4)
                                VStack(alignment: .leading, spacing: 2) {
                                    HStack {
                                        Text(event.title)
                                            .font(.caption.bold())
                                            .foregroundColor(SkyTheme.textPrimary)
                                        Spacer()
                                        Text(event.timestamp.formatted(date: .omitted, time: .standard))
                                            .font(.caption2)
                                            .foregroundColor(SkyTheme.textMuted)
                                    }
                                    Text(event.detail)
                                        .font(.caption2)
                                        .foregroundColor(SkyTheme.textSecondary)
                                }
                            }
                            Divider().background(SkyTheme.panelBorder)
                        }
                    }
                }
                .skyPanel()
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 32)
        }
        .background(SkyTheme.background.ignoresSafeArea())
    }
}

private struct CheckBadge: View {
    let title: String
    let passed: Bool
    
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: passed ? "checkmark.circle.fill" : "xmark.circle.fill")
                .foregroundColor(passed ? SkyTheme.normalGreen : SkyTheme.criticalRed)
            Text(title)
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(SkyTheme.textPrimary)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity)
        .background(SkyTheme.panelSecondary)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}
