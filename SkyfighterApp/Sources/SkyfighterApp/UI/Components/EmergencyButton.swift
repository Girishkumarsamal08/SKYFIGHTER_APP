import SwiftUI

public struct EmergencyButton: View {
    public let action: () -> Void
    @State private var isPressing = false
    
    public init(action: @escaping () -> Void) {
        self.action = action
    }
    
    public var body: some View {
        Button(action: {
            action()
        }) {
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.octagon.fill")
                    .font(.system(size: 16, weight: .bold))
                Text("EMERGENCY STOP")
                    .font(.system(size: 13, weight: .black, design: .monospaced))
            }
            .foregroundColor(.white)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(SkyTheme.criticalRed)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .shadow(color: SkyTheme.criticalRed.opacity(0.4), radius: 6, y: 3)
        }
    }
}
