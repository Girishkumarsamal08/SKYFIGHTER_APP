import SwiftUI

public struct ConnectionView: View {
    @ObservedObject public var connectionManager: DroneConnectionManager
    
    public init(connectionManager: DroneConnectionManager) {
        self.connectionManager = connectionManager
    }
    
    private var isConnected: Bool {
        connectionManager.status.isConnected
    }
    
    public var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Header Bar
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("CONNECTION SETTINGS")
                            .font(.system(size: 20, weight: .black, design: .monospaced))
                            .foregroundColor(SkyTheme.textPrimary)
                        Text("ESP32 #2 Wi-Fi Gateway Configuration")
                            .font(.system(size: 11))
                            .foregroundColor(SkyTheme.textSecondary)
                    }
                    Spacer()
                    StatusBadge(
                        text: connectionManager.status.displayText,
                        icon: isConnected ? "link.circle.fill" : "link.badge.plus",
                        color: isConnected ? SkyTheme.normalGreen : SkyTheme.textMuted
                    )
                }
                .padding(.top, 4)
                
                // Connection Endpoint Card
                VStack(alignment: .leading, spacing: 12) {
                    Text("NETWORK PARAMETERS")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundColor(SkyTheme.textSecondary)
                    
                    VStack(alignment: .leading, spacing: 4) {
                        Text("ESP32 Wi-Fi SSID")
                            .font(.caption)
                            .foregroundColor(SkyTheme.textMuted)
                        TextField("SSID", text: $connectionManager.config.ssid)
                            .padding(10)
                            .background(SkyTheme.panelSecondary)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .foregroundColor(SkyTheme.textPrimary)
                    }
                    
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Gateway IP Address")
                                .font(.caption)
                                .foregroundColor(SkyTheme.textMuted)
                            TextField("Host IP", text: $connectionManager.config.host)
                                .padding(10)
                                .background(SkyTheme.panelSecondary)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                                .foregroundColor(SkyTheme.textPrimary)
                        }
                        
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Port")
                                .font(.caption)
                                .foregroundColor(SkyTheme.textMuted)
                            TextField("Port", value: $connectionManager.config.port, format: .number)
                                .padding(10)
                                .background(SkyTheme.panelSecondary)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                                .foregroundColor(SkyTheme.textPrimary)
                                .frame(width: 80)
                        }
                    }
                    
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Transport Protocol")
                            .font(.caption)
                            .foregroundColor(SkyTheme.textMuted)
                        Picker("Transport", selection: $connectionManager.config.transportMode) {
                            ForEach(TransportMode.allCases, id: \.self) { mode in
                                Text(mode.rawValue).tag(mode)
                            }
                        }
                        .pickerStyle(.menu)
                        .tint(SkyTheme.accentCyan)
                    }
                    
                    // Connect / Disconnect Action
                    Button(action: {
                        if isConnected {
                            Task { await connectionManager.disconnect() }
                        } else {
                            Task { await connectionManager.connect() }
                        }
                    }) {
                        HStack(spacing: 8) {
                            Image(systemName: isConnected ? "bolt.slash.fill" : "bolt.fill")
                            Text(isConnected ? "DISCONNECT FROM GATEWAY" : "CONNECT TO DRONE GATEWAY")
                                .font(.subheadline.bold())
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(isConnected ? SkyTheme.criticalRed : SkyTheme.accentCyan)
                        .foregroundColor(isConnected ? .white : .black)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                }
                .skyPanel()
                
                // iPhone Wi-Fi Warning Note
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "wifi.exclamationmark")
                        .foregroundColor(SkyTheme.warningAmber)
                        .padding(.top, 2)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Important iOS Wi-Fi Behavior")
                            .font(.caption.bold())
                            .foregroundColor(SkyTheme.textPrimary)
                        Text("To communicate with the drone in the field, join the ESP32's Wi-Fi network ('\(connectionManager.config.ssid)') in iOS Settings. Your iPhone will communicate locally with the drone gateway and may temporarily show 'No Internet Connection'.")
                            .font(.caption2)
                            .foregroundColor(SkyTheme.textSecondary)
                    }
                }
                .skyPanel(borderColor: SkyTheme.warningAmber.opacity(0.4))
                
                // Firmware Capabilities Audit Matrix
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Label("FIRMWARE HARDWARE MANIFEST", systemImage: "checklist")
                            .font(.system(size: 10, weight: .bold, design: .monospaced))
                            .foregroundColor(SkyTheme.textSecondary)
                        Spacer()
                        Text("ESP32 #1 & #2")
                            .font(.caption2)
                            .foregroundColor(SkyTheme.textMuted)
                    }
                    
                    ForEach(HardwareManifest.components) { item in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(item.componentName)
                                    .font(.caption.bold())
                                    .foregroundColor(SkyTheme.textPrimary)
                                Spacer()
                                ManifestBadge(state: item.state)
                            }
                            Text("\(item.hardwareTarget) • \(item.description)")
                                .font(.caption2)
                                .foregroundColor(SkyTheme.textMuted)
                        }
                        .padding(8)
                        .background(SkyTheme.panelSecondary)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
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

private struct ManifestBadge: View {
    let state: FeatureImplementationState
    
    var color: Color {
        switch state {
        case .verifiedImplemented: return SkyTheme.normalGreen
        case .bridgeInProgress: return SkyTheme.accentCyan
        case .plannedUnverified: return SkyTheme.warningAmber
        case .unavailable: return SkyTheme.textMuted
        }
    }
    
    var body: some View {
        Text(state.rawValue)
            .font(.system(size: 9, weight: .bold, design: .monospaced))
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(color.opacity(0.15))
            .foregroundColor(color)
            .clipShape(Capsule())
    }
}
