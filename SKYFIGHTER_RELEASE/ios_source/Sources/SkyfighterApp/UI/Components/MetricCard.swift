import SwiftUI

public struct MetricCard: View {
    public let title: String
    public let value: String
    public let unit: String?
    public let icon: String
    public let statusColor: Color
    public let subtitle: String?
    
    public init(
        title: String,
        value: String,
        unit: String? = nil,
        icon: String,
        statusColor: Color = SkyTheme.accentCyan,
        subtitle: String? = nil
    ) {
        self.title = title
        self.value = value
        self.unit = unit
        self.icon = icon
        self.statusColor = statusColor
        self.subtitle = subtitle
    }
    
    public var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(statusColor)
                Text(title.uppercased())
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundColor(SkyTheme.textSecondary)
                Spacer()
                Circle()
                    .fill(statusColor)
                    .frame(width: 6, height: 6)
            }
            
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(value)
                    .font(.system(size: 22, weight: .bold, design: .rounded))
                    .foregroundColor(SkyTheme.textPrimary)
                if let unit = unit {
                    Text(unit)
                        .font(.system(size: 12, weight: .semibold, design: .monospaced))
                        .foregroundColor(SkyTheme.textMuted)
                }
            }
            
            if let subtitle = subtitle {
                Text(subtitle)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(SkyTheme.textMuted)
                    .lineLimit(1)
            }
        }
        .skyPanel(borderColor: statusColor.opacity(0.3))
    }
}
