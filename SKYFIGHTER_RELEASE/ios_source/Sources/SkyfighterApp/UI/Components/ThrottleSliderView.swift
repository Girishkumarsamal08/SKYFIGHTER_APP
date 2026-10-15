import SwiftUI

public struct ThrottleSliderView: View {
    @Binding public var throttle: Double // 0.0 to 1.0
    public let isArmed: Bool
    
    public let height: CGFloat = 190.0
    public let width: CGFloat = 64.0
    
    public init(throttle: Binding<Double>, isArmed: Bool) {
        self._throttle = throttle
        self.isArmed = isArmed
    }
    
    public var body: some View {
        VStack(spacing: 6) {
            Text("\(Int(throttle * 100))%")
                .font(.system(size: 13, weight: .bold, design: .monospaced))
                .foregroundColor(isArmed ? SkyTheme.accentCyan : SkyTheme.textMuted)
            
            GeometryReader { geo in
                ZStack(alignment: .bottom) {
                    // Track background
                    RoundedRectangle(cornerRadius: 12)
                        .fill(SkyTheme.panelBackground)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(SkyTheme.panelBorder, lineWidth: 1.5)
                        )
                    
                    // Filled level
                    RoundedRectangle(cornerRadius: 12)
                        .fill(
                            LinearGradient(
                                colors: isArmed ? [SkyTheme.accentCyan, SkyTheme.normalGreen] : [SkyTheme.textMuted],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                        .frame(height: max(10, CGFloat(throttle) * geo.size.height))
                        .opacity(isArmed ? 0.7 : 0.3)
                    
                    // Thumb handle
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color.white)
                        .frame(width: width - 8, height: 24)
                        .shadow(color: Color.black.opacity(0.4), radius: 4, y: 2)
                        .offset(y: -CGFloat(throttle) * (geo.size.height - 24))
                }
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { gesture in
                            guard isArmed else {
                                throttle = 0.0
                                return
                            }
                            let locationY = geo.size.height - gesture.location.y
                            let normalized = max(0.0, min(1.0, Double(locationY / geo.size.height)))
                            throttle = normalized
                        }
                )
            }
            .frame(width: width, height: height)
            
            Text("THROTTLE")
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundColor(SkyTheme.textSecondary)
        }
    }
}
