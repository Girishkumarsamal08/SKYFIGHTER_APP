import SwiftUI

public enum SkyTheme {
    // Core Palette: Technical Dark Charcoal & Navy
    public static let background = Color(red: 10/255, green: 15/255, blue: 29/255)
    public static let panelBackground = Color(red: 19/255, green: 27/255, blue: 46/255)
    public static let panelSecondary = Color(red: 27/255, green: 38/255, blue: 64/255)
    public static let panelBorder = Color(red: 35/255, green: 50/255, blue: 82/255)
    
    // Accents & Indicators
    public static let normalGreen = Color(red: 46/255, green: 204/255, blue: 113/255)
    public static let warningAmber = Color(red: 243/255, green: 156/255, blue: 18/255)
    public static let criticalRed = Color(red: 231/255, green: 76/255, blue: 60/255)
    public static let accentCyan = Color(red: 14/255, green: 165/255, blue: 233/255)
    
    // Typography Colors
    public static let textPrimary = Color(red: 241/255, green: 245/255, blue: 249/255)
    public static let textSecondary = Color(red: 148/255, green: 163/255, blue: 184/255)
    public static let textMuted = Color(red: 100/255, green: 116/255, blue: 139/255)
}

public struct PanelModifier: ViewModifier {
    public var borderColor: Color = SkyTheme.panelBorder
    
    public func body(content: Content) -> some View {
        content
            .padding(14)
            .background(SkyTheme.panelBackground)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .stroke(borderColor, lineWidth: 1)
            )
    }
}

public extension View {
    func skyPanel(borderColor: Color = SkyTheme.panelBorder) -> some View {
        modifier(PanelModifier(borderColor: borderColor))
    }
}
