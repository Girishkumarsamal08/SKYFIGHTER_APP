import SwiftUI

public struct ManualControlView: View {
    @ObservedObject public var connectionManager: DroneConnectionManager
    @ObservedObject public var controllerManager: GameControllerManager
    
    // Manual Virtual Inputs
    @State private var virtualRoll: Double = 0.0
    @State private var virtualPitch: Double = 0.0
    @State private var virtualYaw: Double = 0.0
    @State private var virtualThrottle: Double = 0.0
    
    // Safety & Dialogs
    @State private var showArmingSheet: Bool = false
    @State private var isArmedState: Bool = false
    @State private var emergencyWarningMessage: String?
    @State private var loopTimer: Timer?
    
    public init(connectionManager: DroneConnectionManager, controllerManager: GameControllerManager) {
        self.connectionManager = connectionManager
        self.controllerManager = controllerManager
    }
    
    private var isConnected: Bool {
        connectionManager.status.isConnected
    }
    
    private var isSimulating: Bool {
        connectionManager.config.transportMode == .mockSimulation
    }
    
    public var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Header Bar
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("MANUAL FLIGHT")
                            .font(.system(size: 20, weight: .black, design: .monospaced))
                            .foregroundColor(SkyTheme.textPrimary)
                        Text("Pilot Control Station")
                            .font(.system(size: 11))
                            .foregroundColor(SkyTheme.textSecondary)
                    }
                    Spacer()
                    
                    // Physical Gamepad status badge
                    if controllerManager.isControllerConnected {
                        StatusBadge(
                            text: controllerManager.isConfirmedForFlight ? "GAMEPAD ACTIVE" : "GAMEPAD UNARMED",
                            icon: "gamecontroller.fill",
                            color: controllerManager.isConfirmedForFlight ? SkyTheme.normalGreen : SkyTheme.warningAmber
                        )
                    } else {
                        StatusBadge(
                            text: "TOUCH CONTROLS",
                            icon: "hand.tap.fill",
                            color: SkyTheme.accentCyan
                        )
                    }
                }
                .padding(.top, 4)
                
                // Safety Simulation Mode Toggle Banner
                HStack {
                    Image(systemName: isSimulating ? "shield.badge.checkmark" : "bolt.shield")
                        .foregroundColor(isSimulating ? SkyTheme.normalGreen : SkyTheme.warningAmber)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(isSimulating ? "UI Safe Simulation Mode Active" : "Live Hardware Mode")
                            .font(.caption.bold())
                            .foregroundColor(SkyTheme.textPrimary)
                        Text(isSimulating ? "Inputs will not drive physical motors." : "Commands forwarded to ESP32 gateway.")
                            .font(.caption2)
                            .foregroundColor(SkyTheme.textMuted)
                    }
                    Spacer()
                    Button(action: {
                        let newMode: TransportMode = isSimulating ? .webSocket : .mockSimulation
                        connectionManager.updateTransportMode(newMode)
                    }) {
                        Text(isSimulating ? "Switch Live" : "Switch Sim")
                            .font(.caption2.bold())
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(SkyTheme.panelSecondary)
                            .clipShape(Capsule())
                    }
                }
                .skyPanel()
                
                // Disconnected Warning Banner
                if !isConnected {
                    HStack {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundColor(SkyTheme.warningAmber)
                        Text("Flight controls locked: Drone transport disconnected.")
                            .font(.caption)
                            .fontWeight(.semibold)
                            .foregroundColor(SkyTheme.warningAmber)
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity)
                    .background(SkyTheme.warningAmber.opacity(0.15))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }
                
                // Arming & Emergency Controls Bar
                HStack(spacing: 12) {
                    // Arm / Disarm Button
                    Button(action: {
                        if isArmedState {
                            // Instant Disarm
                            disarmDrone()
                        } else {
                            showArmingSheet = true
                        }
                    }) {
                        HStack(spacing: 8) {
                            Image(systemName: isArmedState ? "lock.open.fill" : "lock.fill")
                            Text(isArmedState ? "DISARM MOTORS" : "ARM MOTORS")
                                .font(.system(size: 13, weight: .bold, design: .monospaced))
                        }
                        .foregroundColor(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .background(isArmedState ? SkyTheme.criticalRed : SkyTheme.normalGreen)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .disabled(!isConnected)
                    .opacity(isConnected ? 1.0 : 0.5)
                    
                    Spacer()
                    
                    // Emergency Stop Action
                    EmergencyButton {
                        triggerEmergencyStop()
                    }
                }
                
                // Live Command Readings Display
                VStack(spacing: 8) {
                    Text("CURRENT COMMAND VALUES")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundColor(SkyTheme.textMuted)
                    
                    HStack(spacing: 16) {
                        CommandGauge(label: "ROLL", value: activeRoll)
                        CommandGauge(label: "PITCH", value: activePitch)
                        CommandGauge(label: "YAW", value: activeYaw)
                        CommandGauge(label: "THROTTLE", value: activeThrottle)
                    }
                }
                .skyPanel()
                
                // Dual Flight Control Pad (Throttle Slider + Pitch/Roll Virtual Joystick)
                HStack(alignment: .center, spacing: 24) {
                    // Left: Throttle & Yaw
                    VStack(spacing: 14) {
                        ThrottleSliderView(throttle: $virtualThrottle, isArmed: isArmedState)
                        
                        // Yaw Left / Right Buttons
                        HStack(spacing: 8) {
                            Button(action: {}) {
                                Image(systemName: "arrow.counterclockwise")
                                    .font(.headline)
                                    .frame(width: 38, height: 38)
                                    .background(SkyTheme.panelSecondary)
                                    .clipShape(Circle())
                            }
                            .simultaneousGesture(
                                DragGesture(minimumDistance: 0)
                                    .onChanged { _ in virtualYaw = -0.5 }
                                    .onEnded { _ in virtualYaw = 0.0 }
                            )
                            
                            Button(action: {}) {
                                Image(systemName: "arrow.clockwise")
                                    .font(.headline)
                                    .frame(width: 38, height: 38)
                                    .background(SkyTheme.panelSecondary)
                                    .clipShape(Circle())
                            }
                            .simultaneousGesture(
                                DragGesture(minimumDistance: 0)
                                    .onChanged { _ in virtualYaw = 0.5 }
                                    .onEnded { _ in virtualYaw = 0.0 }
                            )
                        }
                        Text("YAW")
                            .font(.system(size: 9, weight: .bold, design: .monospaced))
                            .foregroundColor(SkyTheme.textSecondary)
                    }
                    
                    // Right: Roll & Pitch Joystick
                    VStack(spacing: 10) {
                        Text("CYCLIC (ROLL & PITCH)")
                            .font(.system(size: 10, weight: .bold, design: .monospaced))
                            .foregroundColor(SkyTheme.textSecondary)
                        
                        VirtualJoystickView(valueX: $virtualRoll, valueY: $virtualPitch)
                        
                        Text("Returns to center when released")
                            .font(.system(size: 9))
                            .foregroundColor(SkyTheme.textMuted)
                    }
                }
                .skyPanel()
                
                // Firmware Disclaimer Box
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "info.circle")
                        .foregroundColor(SkyTheme.textMuted)
                        .padding(.top, 2)
                    Text("Disclaimer: Software safety buttons instruct the drone over Wi-Fi. Real motor cutoff depends on verified onboard flight controller firmware failsafe routines.")
                        .font(.caption2)
                        .foregroundColor(SkyTheme.textMuted)
                }
                .padding(.horizontal, 8)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 32)
        }
        .background(SkyTheme.background.ignoresSafeArea())
        .sheet(isPresented: $showArmingSheet) {
            ArmingModalView(isPresented: $showArmingSheet) { token in
                armDrone(token: token)
            }
        }
        .onAppear {
            startCommandLoop()
        }
        .onDisappear {
            stopCommandLoop()
        }
    }
    
    // Computed active values (Gamepad takes precedence if confirmed)
    private var activeRoll: Double {
        if let gamepad = controllerManager.currentFlightInput(isArmed: isArmedState) {
            return gamepad.roll
        }
        return virtualRoll
    }
    
    private var activePitch: Double {
        if let gamepad = controllerManager.currentFlightInput(isArmed: isArmedState) {
            return gamepad.pitch
        }
        return virtualPitch
    }
    
    private var activeYaw: Double {
        if let gamepad = controllerManager.currentFlightInput(isArmed: isArmedState) {
            return gamepad.yaw
        }
        return virtualYaw
    }
    
    private var activeThrottle: Double {
        if let gamepad = controllerManager.currentFlightInput(isArmed: isArmedState) {
            return gamepad.throttle
        }
        return virtualThrottle
    }
    
    private func armDrone(token: String) {
        isArmedState = true
        Task {
            try? await connectionManager.sendArming(arm: true, confirmationToken: token)
        }
    }
    
    private func disarmDrone() {
        isArmedState = false
        virtualThrottle = 0.0
        Task {
            try? await connectionManager.sendArming(arm: false, confirmationToken: "DISARM")
        }
    }
    
    private func triggerEmergencyStop() {
        isArmedState = false
        virtualThrottle = 0.0
        virtualRoll = 0.0
        virtualPitch = 0.0
        virtualYaw = 0.0
        Task {
            try? await connectionManager.sendEmergencyStop()
        }
    }
    
    private func startCommandLoop() {
        loopTimer?.invalidate()
        // 20Hz flight transmission loop
        loopTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
            Task { @MainActor in
                guard isConnected else { return }
                let input = connectionManager.commandValidator.sanitizeInput(
                    roll: activeRoll,
                    pitch: activePitch,
                    yaw: activeYaw,
                    throttle: activeThrottle,
                    isArmed: isArmedState
                )
                try? await connectionManager.sendManualFlight(input: input)
            }
        }
    }
    
    private func stopCommandLoop() {
        loopTimer?.invalidate()
        loopTimer = nil
    }
}

private struct CommandGauge: View {
    let label: String
    let value: Double
    
    var body: some View {
        VStack(spacing: 2) {
            Text(label)
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundColor(SkyTheme.textMuted)
            Text(String(format: "%.2f", value))
                .font(.system(size: 13, weight: .bold, design: .monospaced))
                .foregroundColor(abs(value) > 0.01 ? SkyTheme.accentCyan : SkyTheme.textPrimary)
        }
    }
}
