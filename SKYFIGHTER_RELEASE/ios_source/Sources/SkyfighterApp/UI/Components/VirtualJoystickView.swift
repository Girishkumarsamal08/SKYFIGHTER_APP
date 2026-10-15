import SwiftUI

public struct VirtualJoystickView: View {
    @Binding public var valueX: Double // -1.0 to 1.0 (Roll)
    @Binding public var valueY: Double // -1.0 to 1.0 (Pitch)
    
    public let radius: CGFloat = 85.0
    public let thumbRadius: CGFloat = 28.0
    
    @State private var dragOffset: CGSize = .zero
    
    public init(valueX: Binding<Double>, valueY: Binding<Double>) {
        self._valueX = valueX
        self._valueY = valueY
    }
    
    public var body: some View {
        ZStack {
            // Outer ring
            Circle()
                .fill(SkyTheme.panelBackground)
                .frame(width: radius * 2, height: radius * 2)
                .overlay(
                    Circle()
                        .stroke(SkyTheme.panelBorder, lineWidth: 2)
                )
            
            // Subtle crosshairs
            Path { path in
                path.move(to: CGPoint(x: 0, y: radius))
                path.addLine(to: CGPoint(x: radius * 2, y: radius))
                path.move(to: CGPoint(x: radius, y: 0))
                path.addLine(to: CGPoint(x: radius, y: radius * 2))
            }
            .stroke(SkyTheme.panelBorder.opacity(0.6), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
            .frame(width: radius * 2, height: radius * 2)
            
            // Deadzone center circle
            Circle()
                .stroke(SkyTheme.panelBorder.opacity(0.4), lineWidth: 1)
                .frame(width: radius * 0.4, height: radius * 0.4)
            
            // Movable Thumbstick
            Circle()
                .fill(
                    LinearGradient(
                        colors: [SkyTheme.accentCyan, SkyTheme.panelSecondary],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .frame(width: thumbRadius * 2, height: thumbRadius * 2)
                .overlay(
                    Circle()
                        .stroke(Color.white.opacity(0.4), lineWidth: 1.5)
                )
                .shadow(color: SkyTheme.accentCyan.opacity(0.3), radius: 8, x: 0, y: 4)
                .offset(dragOffset)
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { gesture in
                            let rawX = gesture.translation.width
                            let rawY = gesture.translation.height
                            let distance = sqrt(rawX * rawX + rawY * rawY)
                            let maxDistance = radius - thumbRadius
                            
                            if distance <= maxDistance {
                                dragOffset = gesture.translation
                            } else {
                                let angle = atan2(rawY, rawX)
                                dragOffset = CGSize(
                                    width: cos(angle) * maxDistance,
                                    height: sin(angle) * maxDistance
                                )
                            }
                            
                            // Normalize to -1.0 ... 1.0 (Invert Y so up is positive)
                            valueX = Double(dragOffset.width / maxDistance)
                            valueY = Double(-dragOffset.height / maxDistance)
                        }
                        .onEnded { _ in
                            // Spring-back to neutral
                            withAnimation(.spring(response: 0.25, dampingFraction: 0.6)) {
                                dragOffset = .zero
                                valueX = 0.0
                                valueY = 0.0
                            }
                        }
                )
        }
    }
}
