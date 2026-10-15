import SwiftUI

public struct ArmingModalView: View {
    @Binding public var isPresented: Bool
    public let onConfirmArm: (String) -> Void
    
    @State private var checkPropellersClear = false
    @State private var checkFailsafeUnderstood = false
    @State private var checkPhysicalSafety = false
    @State private var sliderProgress: CGFloat = 0.0
    
    public init(isPresented: Binding<Bool>, onConfirmArm: @escaping (String) -> Void) {
        self._isPresented = isPresented
        self.onConfirmArm = onConfirmArm
    }
    
    private var allChecksPassed: Bool {
        checkPropellersClear && checkFailsafeUnderstood && checkPhysicalSafety
    }
    
    public var body: some View {
        VStack(spacing: 20) {
            // Header
            HStack {
                Image(systemName: "shield.lefthalf.filled.trianglebadge.exclamationmark")
                    .font(.title2)
                    .foregroundColor(SkyTheme.warningAmber)
                Text("Preflight Safety Checklist")
                    .font(.headline)
                    .foregroundColor(SkyTheme.textPrimary)
                Spacer()
                Button(action: { isPresented = false }) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title3)
                        .foregroundColor(SkyTheme.textMuted)
                }
            }
            .padding(.top, 8)
            
            VStack(alignment: .leading, spacing: 14) {
                Text("Arming enables motor rotation. Verify all physical safety conditions before proceeding:")
                    .font(.footnote)
                    .foregroundColor(SkyTheme.textSecondary)
                
                Toggle(isOn: $checkPropellersClear) {
                    Text("Propeller rotation path is 100% clear of all persons and obstructions.")
                        .font(.subheadline)
                        .foregroundColor(SkyTheme.textPrimary)
                }
                .tint(SkyTheme.accentCyan)
                
                Toggle(isOn: $checkFailsafeUnderstood) {
                    Text("Pilot understands phone disconnect relies on onboard failsafe behavior.")
                        .font(.subheadline)
                        .foregroundColor(SkyTheme.textPrimary)
                }
                .tint(SkyTheme.accentCyan)
                
                Toggle(isOn: $checkPhysicalSafety) {
                    Text("Drone is placed on a flat, level takeoff surface.")
                        .font(.subheadline)
                        .foregroundColor(SkyTheme.textPrimary)
                }
                .tint(SkyTheme.accentCyan)
            }
            .skyPanel()
            
            // Slide to Arm
            VStack(spacing: 8) {
                Text(allChecksPassed ? "Slide right to complete ARMING" : "Complete checklist to unlock arming")
                    .font(.caption)
                    .fontWeight(.bold)
                    .foregroundColor(allChecksPassed ? SkyTheme.warningAmber : SkyTheme.textMuted)
                
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(SkyTheme.panelBackground)
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(allChecksPassed ? SkyTheme.warningAmber.opacity(0.5) : SkyTheme.panelBorder, lineWidth: 1.5)
                            )
                        
                        RoundedRectangle(cornerRadius: 12)
                            .fill(SkyTheme.warningAmber.opacity(0.3))
                            .frame(width: max(50, sliderProgress * geo.size.width))
                        
                        HStack {
                            ZStack {
                                Circle()
                                    .fill(allChecksPassed ? SkyTheme.warningAmber : SkyTheme.textMuted)
                                    .frame(width: 44, height: 44)
                                Image(systemName: "lock.open.fill")
                                    .foregroundColor(.black)
                                    .font(.headline)
                            }
                            .offset(x: sliderProgress * (geo.size.width - 50))
                            .gesture(
                                DragGesture()
                                    .onChanged { val in
                                        guard allChecksPassed else { return }
                                        let maxW = geo.size.width - 50
                                        sliderProgress = max(0.0, min(1.0, val.translation.width / maxW))
                                    }
                                    .onEnded { _ in
                                        if sliderProgress >= 0.85 {
                                            let token = UUID().uuidString
                                            onConfirmArm(token)
                                            isPresented = false
                                        } else {
                                            withAnimation { sliderProgress = 0.0 }
                                        }
                                    }
                            )
                            Spacer()
                        }
                        .padding(.horizontal, 3)
                    }
                }
                .frame(height: 52)
                .opacity(allChecksPassed ? 1.0 : 0.5)
            }
            
            Spacer()
        }
        .padding(20)
        .background(SkyTheme.background.ignoresSafeArea())
    }
}
