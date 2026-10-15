import SwiftUI

public struct GameControllerView: View {
    @ObservedObject public var controllerManager: GameControllerManager
    
    public init(controllerManager: GameControllerManager) {
        self.controllerManager = controllerManager
    }
    
    public var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Header Bar
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("GAME CONTROLLER")
                            .font(.system(size: 20, weight: .black, design: .monospaced))
                            .foregroundColor(SkyTheme.textPrimary)
                        Text("Hardware Joystick Input (GameController Framework)")
                            .font(.system(size: 11))
                            .foregroundColor(SkyTheme.textSecondary)
                    }
                    Spacer()
                    StatusBadge(
                        text: controllerManager.isControllerConnected ? "CONNECTED" : "NO CONTROLLER",
                        icon: "gamecontroller.fill",
                        color: controllerManager.isControllerConnected ? SkyTheme.normalGreen : SkyTheme.textMuted
                    )
                }
                .padding(.top, 4)
                
                // Device Info Card
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Image(systemName: "gamecontroller")
                            .font(.title2)
                            .foregroundColor(controllerManager.isControllerConnected ? SkyTheme.accentCyan : SkyTheme.textMuted)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(controllerManager.controllerName)
                                .font(.headline)
                                .foregroundColor(SkyTheme.textPrimary)
                            Text(controllerManager.isControllerConnected ? "Supported Apple MFi / DualSense / Xbox / USB-C Controller" : "Connect a wireless or USB-C MFi gamepad to iPhone")
                                .font(.caption)
                                .foregroundColor(SkyTheme.textSecondary)
                        }
                    }
                    
                    if controllerManager.isControllerConnected {
                        Divider().background(SkyTheme.panelBorder)
                        
                        // Safety Confirmation Gate
                        Toggle(isOn: $controllerManager.isConfirmedForFlight) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Authorize Controller for Flight Control")
                                    .font(.subheadline.bold())
                                    .foregroundColor(SkyTheme.textPrimary)
                                Text("Enables thumbstick input to drive drone pitch, roll, yaw, and throttle.")
                                    .font(.caption2)
                                    .foregroundColor(SkyTheme.textSecondary)
                            }
                        }
                        .tint(SkyTheme.normalGreen)
                    }
                }
                .skyPanel()
                
                // Live Input Visualizer Card
                VStack(alignment: .leading, spacing: 14) {
                    Text("LIVE INPUT DIAGNOSTICS & TEST")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundColor(SkyTheme.textSecondary)
                    
                    HStack(spacing: 24) {
                        // Left Stick Visualizer
                        VStack(spacing: 8) {
                            StickPositionVisualizer(
                                posX: controllerManager.leftStickX,
                                posY: controllerManager.leftStickY,
                                deadZone: controllerManager.deadZone
                            )
                            Text("LEFT THUMBSTICK")
                                .font(.system(size: 9, weight: .bold, design: .monospaced))
                                .foregroundColor(SkyTheme.textSecondary)
                            Text("X: \(String(format: "%.2f", controllerManager.leftStickX)) | Y: \(String(format: "%.2f", controllerManager.leftStickY))")
                                .font(.system(size: 9, design: .monospaced))
                                .foregroundColor(SkyTheme.textMuted)
                        }
                        .frame(maxWidth: .infinity)
                        
                        // Right Stick Visualizer
                        VStack(spacing: 8) {
                            StickPositionVisualizer(
                                posX: controllerManager.rightStickX,
                                posY: controllerManager.rightStickY,
                                deadZone: controllerManager.deadZone
                            )
                            Text("RIGHT THUMBSTICK")
                                .font(.system(size: 9, weight: .bold, design: .monospaced))
                                .foregroundColor(SkyTheme.textSecondary)
                            Text("X: \(String(format: "%.2f", controllerManager.rightStickX)) | Y: \(String(format: "%.2f", controllerManager.rightStickY))")
                                .font(.system(size: 9, design: .monospaced))
                                .foregroundColor(SkyTheme.textMuted)
                        }
                        .frame(maxWidth: .infinity)
                    }
                    
                    // Button / Trigger indicators
                    HStack(spacing: 12) {
                        ButtonTestBadge(label: "Btn A", isPressed: controllerManager.isButtonAPressed)
                        ButtonTestBadge(label: "Btn B", isPressed: controllerManager.isButtonBPressed)
                        TriggerTestBadge(label: "L Trig", value: controllerManager.leftTrigger)
                        TriggerTestBadge(label: "R Trig", value: controllerManager.rightTrigger)
                    }
                }
                .skyPanel()
                
                // Calibration & Mapping Settings
                VStack(alignment: .leading, spacing: 14) {
                    Text("AXIS CONFIGURATION & MAPPING")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundColor(SkyTheme.textSecondary)
                    
                    // Control Mode Picker
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Stick Flight Mapping")
                            .font(.subheadline.bold())
                            .foregroundColor(SkyTheme.textPrimary)
                        Picker("Control Mode", selection: $controllerManager.controlMode) {
                            ForEach(StickControlMode.allCases, id: \.self) { mode in
                                Text(mode.rawValue).tag(mode)
                            }
                        }
                        .pickerStyle(.menu)
                        .tint(SkyTheme.accentCyan)
                    }
                    
                    Divider().background(SkyTheme.panelBorder)
                    
                    // Dead Zone Slider
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("Stick Dead Zone")
                                .font(.subheadline)
                                .foregroundColor(SkyTheme.textPrimary)
                            Spacer()
                            Text("\(Int(controllerManager.deadZone * 100))%")
                                .font(.caption.bold())
                                .foregroundColor(SkyTheme.accentCyan)
                        }
                        Slider(value: $controllerManager.deadZone, in: 0.02...0.25, step: 0.01)
                            .tint(SkyTheme.accentCyan)
                        Text("Filters out stick drift around center position.")
                            .font(.caption2)
                            .foregroundColor(SkyTheme.textMuted)
                    }
                    
                    Divider().background(SkyTheme.panelBorder)
                    
                    // Sensitivity Curve Slider
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("Stick Curve Sensitivity")
                                .font(.subheadline)
                                .foregroundColor(SkyTheme.textPrimary)
                            Spacer()
                            Text(String(format: "%.1f", controllerManager.sensitivity))
                                .font(.caption.bold())
                                .foregroundColor(SkyTheme.accentCyan)
                        }
                        Slider(value: $controllerManager.sensitivity, in: 0.5...2.5, step: 0.1)
                            .tint(SkyTheme.accentCyan)
                        Text("Higher values soften center precision for smoother flight maneuvers.")
                            .font(.caption2)
                            .foregroundColor(SkyTheme.textMuted)
                    }
                }
                .skyPanel()
                
                // Architecture Note Box
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "cable.connector")
                        .foregroundColor(SkyTheme.accentCyan)
                        .padding(.top, 2)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Controller vs Drone Connection Architecture")
                            .font(.caption.bold())
                            .foregroundColor(SkyTheme.textPrimary)
                        Text("Physical game controllers connect directly to your iPhone via Bluetooth or USB-C. Commands are decoded in the app and transmitted to the drone gateway (ESP32 #2) exclusively over Wi-Fi.")
                            .font(.caption2)
                            .foregroundColor(SkyTheme.textMuted)
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

private struct StickPositionVisualizer: View {
    let posX: Double
    let posY: Double
    let deadZone: Double
    
    private let size: CGFloat = 110.0
    
    var body: some View {
        ZStack {
            Circle()
                .fill(SkyTheme.panelSecondary)
                .frame(width: size, height: size)
                .overlay(
                    Circle().stroke(SkyTheme.panelBorder, lineWidth: 1.5)
                )
            
            // Deadzone ring
            Circle()
                .stroke(SkyTheme.warningAmber.opacity(0.3), lineWidth: 1)
                .frame(width: size * CGFloat(deadZone) * 2, height: size * CGFloat(deadZone) * 2)
            
            // Crosshairs
            Path { path in
                path.move(to: CGPoint(x: 0, y: size / 2))
                path.addLine(to: CGPoint(x: size, y: size / 2))
                path.move(to: CGPoint(x: size / 2, y: 0))
                path.addLine(to: CGPoint(x: size / 2, y: size))
            }
            .stroke(SkyTheme.panelBorder, lineWidth: 1)
            
            // Stick Dot
            Circle()
                .fill(SkyTheme.accentCyan)
                .frame(width: 18, height: 18)
                .shadow(color: SkyTheme.accentCyan.opacity(0.5), radius: 4)
                .offset(
                    x: CGFloat(posX) * (size / 2 - 10),
                    y: -CGFloat(posY) * (size / 2 - 10)
                )
        }
    }
}

private struct ButtonTestBadge: View {
    let label: String
    let isPressed: Bool
    
    var body: some View {
        Text(label)
            .font(.caption2.bold())
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity)
            .background(isPressed ? SkyTheme.normalGreen : SkyTheme.panelSecondary)
            .foregroundColor(isPressed ? .black : SkyTheme.textMuted)
            .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

private struct TriggerTestBadge: View {
    let label: String
    let value: Double
    
    var body: some View {
        VStack(spacing: 2) {
            Text(label)
                .font(.system(size: 8, weight: .bold))
                .foregroundColor(SkyTheme.textMuted)
            Text("\(Int(value * 100))%")
                .font(.caption2.bold())
                .foregroundColor(value > 0.05 ? SkyTheme.accentCyan : SkyTheme.textMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 4)
        .background(SkyTheme.panelSecondary)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}
