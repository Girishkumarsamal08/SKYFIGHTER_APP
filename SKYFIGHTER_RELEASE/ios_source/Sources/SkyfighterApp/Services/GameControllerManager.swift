import Foundation
import Combine
import GameController

public enum StickControlMode: String, CaseIterable, Sendable {
    case mode2 = "Mode 2 (Throttle/Yaw Left, Pitch/Roll Right)"
    case mode1 = "Mode 1 (Pitch/Yaw Left, Throttle/Roll Right)"
}

@MainActor
public final class GameControllerManager: ObservableObject {
    @Published public var isControllerConnected: Bool = false
    @Published public var controllerName: String = "No Physical Controller Detected"
    @Published public var isConfirmedForFlight: Bool = false
    @Published public var deadZone: Double = 0.08
    @Published public var sensitivity: Double = 1.0 // 1.0 = linear
    @Published public var controlMode: StickControlMode = .mode2
    
    // Live normalized input values for visual test screen (-1.0 to 1.0 or 0.0 to 1.0)
    @Published public var leftStickX: Double = 0.0
    @Published public var leftStickY: Double = 0.0
    @Published public var rightStickX: Double = 0.0
    @Published public var rightStickY: Double = 0.0
    @Published public var leftTrigger: Double = 0.0
    @Published public var rightTrigger: Double = 0.0
    @Published public var isButtonAPressed: Bool = false
    @Published public var isButtonBPressed: Bool = false
    
    private var activeController: GCController?
    private var cancellables = Set<AnyCancellable>()
    
    public init() {
        setupNotifications()
        checkForExistingControllers()
    }
    
    private func setupNotifications() {
        NotificationCenter.default.publisher(for: .GCControllerDidConnect)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] note in
                if let controller = note.object as? GCController {
                    self?.attachController(controller)
                }
            }
            .store(in: &cancellables)
            
        NotificationCenter.default.publisher(for: .GCControllerDidDisconnect)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] note in
                if let controller = note.object as? GCController, controller == self?.activeController {
                    self?.detachController()
                }
            }
            .store(in: &cancellables)
    }
    
    private func checkForExistingControllers() {
        if let first = GCController.controllers().first {
            attachController(first)
        }
    }
    
    private func attachController(_ controller: GCController) {
        activeController = controller
        isControllerConnected = true
        controllerName = controller.vendorName ?? "Generic Game Controller"
        isConfirmedForFlight = false // Safety: Force re-confirmation on new connection
        
        guard let extended = controller.extendedGamepad else { return }
        
        extended.valueChangedHandler = { [weak self] (gamepad, element) in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.leftStickX = Double(gamepad.leftThumbstick.xAxis.value)
                self.leftStickY = Double(gamepad.leftThumbstick.yAxis.value)
                self.rightStickX = Double(gamepad.rightThumbstick.xAxis.value)
                self.rightStickY = Double(gamepad.rightThumbstick.yAxis.value)
                self.leftTrigger = Double(gamepad.leftTrigger.value)
                self.rightTrigger = Double(gamepad.rightTrigger.value)
                self.isButtonAPressed = gamepad.buttonA.isPressed
                self.isButtonBPressed = gamepad.buttonB.isPressed
            }
        }
    }
    
    private func detachController() {
        activeController = nil
        isControllerConnected = false
        controllerName = "No Physical Controller Detected"
        isConfirmedForFlight = false
        leftStickX = 0.0
        leftStickY = 0.0
        rightStickX = 0.0
        rightStickY = 0.0
    }
    
    /// Translates controller thumbsticks into flight command inputs based on selected control mode.
    public func currentFlightInput(isArmed: Bool) -> ValidatedFlightInput? {
        guard isControllerConnected && isConfirmedForFlight else { return nil }
        
        var roll = 0.0
        var pitch = 0.0
        var yaw = 0.0
        var throttle = 0.0
        
        switch controlMode {
        case .mode2:
            // Mode 2: Left stick = Throttle (Y) & Yaw (X), Right stick = Pitch (Y) & Roll (X)
            // Left stick Y ranges from -1 to 1; convert to 0.0 to 1.0 for throttle
            throttle = max(0.0, (leftStickY + 1.0) / 2.0)
            yaw = applyCurve(leftStickX)
            pitch = applyCurve(rightStickY)
            roll = applyCurve(rightStickX)
            
        case .mode1:
            // Mode 1: Right stick = Throttle (Y) & Roll (X), Left stick = Pitch (Y) & Yaw (X)
            throttle = max(0.0, (rightStickY + 1.0) / 2.0)
            yaw = applyCurve(leftStickX)
            pitch = applyCurve(leftStickY)
            roll = applyCurve(rightStickX)
        }
        
        if !isArmed {
            throttle = 0.0
        }
        
        return ValidatedFlightInput(roll: roll, pitch: pitch, yaw: yaw, throttle: throttle)
    }
    
    private func applyCurve(_ value: Double) -> Double {
        if abs(value) <= deadZone { return 0.0 }
        let sign = value > 0 ? 1.0 : -1.0
        let norm = (abs(value) - deadZone) / (1.0 - deadZone)
        // Exponential curve blending
        let curved = pow(norm, sensitivity)
        return sign * curved
    }
}
