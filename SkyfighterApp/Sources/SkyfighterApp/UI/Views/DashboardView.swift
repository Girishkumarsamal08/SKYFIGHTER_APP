import SwiftUI

public struct DashboardView: View {
    @ObservedObject public var connectionManager: DroneConnectionManager
    @ObservedObject public var fireService: FireMonitoringService
    
    public init(connectionManager: DroneConnectionManager, fireService: FireMonitoringService) {
        self.connectionManager = connectionManager
        self.fireService = fireService
    }
    
    private var isConnected: Bool {
        connectionManager.status.isConnected
    }
    
    private var telemetry: TelemetryPacket {
        connectionManager.telemetry
    }
    
    public var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Header Bar
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("SKYFIGHTER")
                            .font(.system(size: 24, weight: .black, design: .monospaced))
                            .foregroundColor(SkyTheme.textPrimary)
                        Text("Forest Fire Detection & Drone Control")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(SkyTheme.textSecondary)
                    }
                    Spacer()
                    
                    // Connection Status Pill
                    StatusBadge(
                        text: isConnected ? "CONNECTED" : (connectionManager.status == .disconnected ? "DISCONNECTED" : "LINK DROPPED"),
                        icon: isConnected ? "wifi" : "wifi.slash",
                        color: isConnected ? SkyTheme.normalGreen : (connectionManager.status == .disconnected ? SkyTheme.textMuted : SkyTheme.criticalRed)
                    )
                }
                .padding(.top, 4)
                
                // Stale Telemetry Warning Banner
                if connectionManager.isTelemetryStale && isConnected {
                    HStack(spacing: 8) {
                        Image(systemName: "clock.badge.exclamationmark.fill")
                            .foregroundColor(SkyTheme.warningAmber)
                        Text("Stale Telemetry: No update received in >\(String(format: "%.1f", connectionManager.config.telemetryTimeoutSeconds))s")
                            .font(.caption)
                            .fontWeight(.semibold)
                            .foregroundColor(SkyTheme.warningAmber)
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity)
                    .background(SkyTheme.warningAmber.opacity(0.15))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }
                
                // Section A: Connection & Transport Card
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Label("COMMUNICATION GATEWAY", systemImage: "antenna.radiowaves.left.and.right")
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .foregroundColor(SkyTheme.textSecondary)
                        Spacer()
                        if !isConnected {
                            Button("Reconnect") {
                                Task { await connectionManager.connect() }
                            }
                            .font(.caption.bold())
                            .foregroundColor(SkyTheme.accentCyan)
                        }
                    }
                    
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("TRANSPORT")
                                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                                .foregroundColor(SkyTheme.textMuted)
                            Text(connectionManager.config.transportMode.rawValue)
                                .font(.system(size: 12, weight: .bold))
                                .foregroundColor(SkyTheme.textPrimary)
                        }
                        Divider().background(SkyTheme.panelBorder)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("LATENCY")
                                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                                .foregroundColor(SkyTheme.textMuted)
                            Text(isConnected ? "\(Int(connectionManager.latencyMs)) ms" : "--")
                                .font(.system(size: 12, weight: .bold, design: .monospaced))
                                .foregroundColor(isConnected ? SkyTheme.accentCyan : SkyTheme.textMuted)
                        }
                        Divider().background(SkyTheme.panelBorder)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("PACKETS")
                                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                                .foregroundColor(SkyTheme.textMuted)
                            Text("\(connectionManager.packetCount)")
                                .font(.system(size: 12, weight: .bold, design: .monospaced))
                                .foregroundColor(SkyTheme.textPrimary)
                        }
                    }
                }
                .skyPanel()
                
                // Section B: Flight & Safety Status
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Label("FLIGHT CONTROLLER STATUS", systemImage: "airplane.circle")
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .foregroundColor(SkyTheme.textSecondary)
                        Spacer()
                        StatusBadge(
                            text: telemetry.flight.armed ? "ARMED" : "DISARMED",
                            icon: telemetry.flight.armed ? "lock.open.fill" : "lock.fill",
                            color: telemetry.flight.armed ? SkyTheme.criticalRed : SkyTheme.normalGreen
                        )
                    }
                    
                    HStack(spacing: 8) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("MODE")
                                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                                .foregroundColor(SkyTheme.textMuted)
                            Text(telemetry.flight.mode.displayName)
                                .font(.system(size: 13, weight: .bold))
                                .foregroundColor(SkyTheme.textPrimary)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 4) {
                            Text("ONBOARD CAPABILITIES")
                                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                                .foregroundColor(SkyTheme.textMuted)
                            HStack(spacing: 6) {
                                CapabilityIndicator(name: "MAN", active: telemetry.flight.capabilities.manualControl)
                                CapabilityIndicator(name: "AUTO", active: telemetry.flight.capabilities.autonomousNavigation)
                                CapabilityIndicator(name: "RTH", active: telemetry.flight.capabilities.returnToHome)
                            }
                        }
                    }
                }
                .skyPanel()
                
                // Section C: Environmental Monitoring (Fire / Smoke / Ambient)
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Label("ENVIRONMENTAL SENSORS", systemImage: "waveform.path.ecg")
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .foregroundColor(SkyTheme.textSecondary)
                        Spacer()
                        StatusBadge(
                            text: fireService.currentState.rawValue,
                            icon: fireService.currentState.icon,
                            color: fireService.currentState.severity == .critical ? SkyTheme.criticalRed : (fireService.currentState.severity == .warning ? SkyTheme.warningAmber : SkyTheme.normalGreen)
                        )
                    }
                    
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                        MetricCard(
                            title: "Ambient Temp",
                            value: telemetry.sensors.temperatureC != nil ? String(format: "%.1f", telemetry.sensors.temperatureC!) : "N/A",
                            unit: "°C",
                            icon: "thermometer.medium",
                            statusColor: (telemetry.sensors.temperatureC ?? 0) > 45 ? SkyTheme.criticalRed : SkyTheme.accentCyan,
                            subtitle: "DHT11 Sensor"
                        )
                        
                        MetricCard(
                            title: "Humidity",
                            value: telemetry.sensors.humidityPct != nil ? String(format: "%.1f", telemetry.sensors.humidityPct!) : "N/A",
                            unit: "%",
                            icon: "humidity.fill",
                            statusColor: SkyTheme.accentCyan,
                            subtitle: "Relative Air"
                        )
                        
                        MetricCard(
                            title: "Smoke (MQ-2)",
                            value: telemetry.sensors.mq2Adc != nil ? "\(telemetry.sensors.mq2Adc!)" : "N/A",
                            unit: "ADC",
                            icon: "smoke.fill",
                            statusColor: (telemetry.sensors.mq2Adc ?? 0) > fireService.smokeThresholdAdc ? SkyTheme.warningAmber : SkyTheme.normalGreen,
                            subtitle: "Baseline + Delta"
                        )
                        
                        MetricCard(
                            title: "Flame Sensor",
                            value: telemetry.sensors.flameDetected != nil ? (telemetry.sensors.flameDetected! ? "DETECTED" : "CLEAR") : "N/A",
                            unit: nil,
                            icon: "flame.fill",
                            statusColor: (telemetry.sensors.flameDetected ?? false) ? SkyTheme.criticalRed : SkyTheme.normalGreen,
                            subtitle: "IR Photodiode DO"
                        )
                    }
                }
                
                // Section D: GPS & Navigation
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Label("GPS NAVIGATION", systemImage: "location.circle")
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .foregroundColor(SkyTheme.textSecondary)
                        Spacer()
                        StatusBadge(
                            text: telemetry.gps.valid ? "3D FIX OK" : "NO FIX",
                            icon: telemetry.gps.valid ? "checkmark.circle.fill" : "xmark.circle.fill",
                            color: telemetry.gps.valid ? SkyTheme.normalGreen : SkyTheme.warningAmber
                        )
                    }
                    
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("COORDINATES")
                                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                                .foregroundColor(SkyTheme.textMuted)
                            if telemetry.gps.valid, let lat = telemetry.gps.latitude, let lon = telemetry.gps.longitude {
                                Text(String(format: "%.5f, %.5f", lat, lon))
                                    .font(.system(size: 12, weight: .bold, design: .monospaced))
                                    .foregroundColor(SkyTheme.textPrimary)
                            } else {
                                Text("Waiting for Satellites...")
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundColor(SkyTheme.textMuted)
                            }
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text("SATELLITES")
                                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                                .foregroundColor(SkyTheme.textMuted)
                            Text(telemetry.gps.satellites != nil ? "\(telemetry.gps.satellites!)" : "--")
                                .font(.system(size: 12, weight: .bold, design: .monospaced))
                                .foregroundColor(SkyTheme.accentCyan)
                        }
                    }
                }
                .skyPanel()
                
                // Section E: Battery Telemetry (Compliant with requirement: Explicitly display unavailable)
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Label("3S LIPO BATTERY", systemImage: "battery.50")
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .foregroundColor(SkyTheme.textSecondary)
                        Spacer()
                        Text("Hardware Unwired")
                            .font(.system(size: 10, weight: .semibold, design: .monospaced))
                            .foregroundColor(SkyTheme.textMuted)
                    }
                    
                    HStack {
                        Image(systemName: "exclamationmark.circle")
                            .foregroundColor(SkyTheme.textMuted)
                        Text("Battery telemetry unavailable (voltage divider circuit not wired on prototype).")
                            .font(.caption)
                            .foregroundColor(SkyTheme.textMuted)
                    }
                }
                .skyPanel()
                
                // Section F: Active Alerts
                if !telemetry.alerts.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("ACTIVE HARDWARE ALERTS", systemImage: "exclamationmark.bubble.fill")
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .foregroundColor(SkyTheme.criticalRed)
                        
                        ForEach(telemetry.alerts) { alert in
                            HStack(alignment: .top, spacing: 8) {
                                Circle()
                                    .fill(alert.severity == .critical ? SkyTheme.criticalRed : SkyTheme.warningAmber)
                                    .frame(width: 8, height: 8)
                                    .padding(.top, 4)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(alert.message)
                                        .font(.subheadline.bold())
                                        .foregroundColor(SkyTheme.textPrimary)
                                    Text("\(alert.source) • \(alert.code)")
                                        .font(.caption2)
                                        .foregroundColor(SkyTheme.textMuted)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                    .skyPanel(borderColor: SkyTheme.criticalRed.opacity(0.4))
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 32)
        }
        .background(SkyTheme.background.ignoresSafeArea())
    }
}

private struct CapabilityIndicator: View {
    let name: String
    let active: Bool
    
    var body: some View {
        Text(name)
            .font(.system(size: 9, weight: .black, design: .monospaced))
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(active ? SkyTheme.normalGreen.opacity(0.2) : SkyTheme.panelSecondary)
            .foregroundColor(active ? SkyTheme.normalGreen : SkyTheme.textMuted)
            .clipShape(RoundedRectangle(cornerRadius: 4))
    }
}
