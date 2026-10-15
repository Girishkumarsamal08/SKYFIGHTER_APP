import SwiftUI

public struct FireAlertView: View {
    @ObservedObject public var fireService: FireMonitoringService
    @ObservedObject public var connectionManager: DroneConnectionManager
    
    public init(fireService: FireMonitoringService, connectionManager: DroneConnectionManager) {
        self.fireService = fireService
        self.connectionManager = connectionManager
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
                        Text("FIRE MONITORING")
                            .font(.system(size: 20, weight: .black, design: .monospaced))
                            .foregroundColor(SkyTheme.textPrimary)
                        Text("Thermal & Combustion Hazard Detection")
                            .font(.system(size: 11))
                            .foregroundColor(SkyTheme.textSecondary)
                    }
                    Spacer()
                    
                    Toggle(isOn: $fireService.audioAlertsEnabled) {
                        Image(systemName: fireService.audioAlertsEnabled ? "speaker.wave.3.fill" : "speaker.slash.fill")
                            .foregroundColor(fireService.audioAlertsEnabled ? SkyTheme.accentCyan : SkyTheme.textMuted)
                    }
                    .toggleStyle(.button)
                    .tint(SkyTheme.panelSecondary)
                }
                .padding(.top, 4)
                
                // Primary Threat State Banner
                VStack(spacing: 8) {
                    HStack(spacing: 10) {
                        Image(systemName: fireService.currentState.icon)
                            .font(.title)
                            .foregroundColor(statusColor)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(fireService.currentState.rawValue)
                                .font(.headline.bold())
                                .foregroundColor(SkyTheme.textPrimary)
                            Text(statusDescription)
                                .font(.caption)
                                .foregroundColor(SkyTheme.textSecondary)
                        }
                        Spacer()
                    }
                }
                .skyPanel(borderColor: statusColor.opacity(0.6))
                
                // Real-time Sensor Metric Grid
                VStack(alignment: .leading, spacing: 10) {
                    Text("LIVE SENSOR TELEMETRY")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundColor(SkyTheme.textSecondary)
                    
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                        MetricCard(
                            title: "Flame Sensor",
                            value: telemetry.sensors.flameDetected != nil ? (telemetry.sensors.flameDetected! ? "FIRE DETECTED" : "NORMAL") : "N/A",
                            unit: nil,
                            icon: "flame.fill",
                            statusColor: (telemetry.sensors.flameDetected ?? false) ? SkyTheme.criticalRed : SkyTheme.normalGreen,
                            subtitle: "Active-Low Digital IO"
                        )
                        
                        MetricCard(
                            title: "Smoke Reading",
                            value: telemetry.sensors.mq2Adc != nil ? "\(telemetry.sensors.mq2Adc!)" : "N/A",
                            unit: "ADC",
                            icon: "smoke.fill",
                            statusColor: (telemetry.sensors.mq2Adc ?? 0) > fireService.smokeThresholdAdc ? SkyTheme.warningAmber : SkyTheme.normalGreen,
                            subtitle: "Threshold: >\(fireService.smokeThresholdAdc)"
                        )
                        
                        MetricCard(
                            title: "Ambient Temp",
                            value: telemetry.sensors.temperatureC != nil ? String(format: "%.1f", telemetry.sensors.temperatureC!) : "N/A",
                            unit: "°C",
                            icon: "thermometer.high",
                            statusColor: (telemetry.sensors.temperatureC ?? 0) > fireService.temperatureThresholdC ? SkyTheme.criticalRed : SkyTheme.accentCyan,
                            subtitle: "DHT11 Sensor"
                        )
                        
                        MetricCard(
                            title: "Air Humidity",
                            value: telemetry.sensors.humidityPct != nil ? String(format: "%.1f", telemetry.sensors.humidityPct!) : "N/A",
                            unit: "%",
                            icon: "humidity.fill",
                            statusColor: SkyTheme.accentCyan,
                            subtitle: "Relative Humidity"
                        )
                    }
                }
                
                // Sensor Correlation & Algorithm Explanation
                VStack(alignment: .leading, spacing: 8) {
                    Label("HAZARD EVALUATION LOGIC", systemImage: "cpu")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundColor(SkyTheme.textSecondary)
                    
                    VStack(alignment: .leading, spacing: 4) {
                        Text("• MULTI-SENSOR ALERT: Triggered when Flame Sensor DO is LOW (active) AND (MQ-2 ADC > \(fireService.smokeThresholdAdc) OR Temp > \(Int(fireService.temperatureThresholdC))°C).")
                        Text("• FLAME DETECTED: Triggered when optical IR flame sensor activates independently.")
                        Text("• POSSIBLE SMOKE: Triggered when MQ-2 gas sensor exceeds calibrated baseline.")
                        Text("• Note: Raw MQ-2 ADC reading reflects analog conductivity, not calibrated ppm concentration.")
                    }
                    .font(.caption2)
                    .foregroundColor(SkyTheme.textMuted)
                }
                .skyPanel()
                
                // Event History Log
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Label("DETECTED INCIDENTS LOG", systemImage: "list.clipboard.fill")
                            .font(.system(size: 10, weight: .bold, design: .monospaced))
                            .foregroundColor(SkyTheme.textSecondary)
                        Spacer()
                        Text("\(fireService.eventHistory.count) logged")
                            .font(.caption2)
                            .foregroundColor(SkyTheme.textMuted)
                    }
                    
                    if fireService.eventHistory.isEmpty {
                        Text("No hazard events recorded during current flight session.")
                            .font(.caption)
                            .foregroundColor(SkyTheme.textMuted)
                            .padding(.vertical, 8)
                    } else {
                        ForEach(fireService.eventHistory) { event in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    StatusBadge(
                                        text: event.state.rawValue,
                                        icon: event.state.icon,
                                        color: event.state.severity == .critical ? SkyTheme.criticalRed : SkyTheme.warningAmber
                                    )
                                    Spacer()
                                    Text(event.timestamp.formatted(date: .omitted, time: .standard))
                                        .font(.caption2.monospaced())
                                        .foregroundColor(SkyTheme.textMuted)
                                }
                                
                                HStack {
                                    if let lat = event.latitude, let lon = event.longitude {
                                        Text("GPS: \(String(format: "%.4f, %.4f", lat, lon))")
                                            .font(.caption2.monospaced())
                                            .foregroundColor(SkyTheme.accentCyan)
                                    } else {
                                        Text("GPS: No Fix at event time")
                                            .font(.caption2)
                                            .foregroundColor(SkyTheme.textMuted)
                                    }
                                    Spacer()
                                    if !event.isAcknowledged {
                                        Button("Acknowledge") {
                                            fireService.acknowledgeEvent(id: event.id)
                                        }
                                        .font(.caption2.bold())
                                        .foregroundColor(SkyTheme.accentCyan)
                                    } else {
                                        Text("Acknowledged")
                                            .font(.caption2)
                                            .foregroundColor(SkyTheme.textMuted)
                                    }
                                }
                            }
                            .padding(10)
                            .background(SkyTheme.panelSecondary)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                    }
                }
                .skyPanel()
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 32)
        }
        .background(SkyTheme.background.ignoresSafeArea())
        .onChange(of: telemetry) { _, newPacket in
            fireService.evaluateTelemetry(
                packet: newPacket,
                isConnected: connectionManager.status.isConnected,
                isStale: connectionManager.isTelemetryStale
            )
        }
    }
    
    private var statusColor: Color {
        switch fireService.currentState.severity {
        case .info: return SkyTheme.normalGreen
        case .warning: return SkyTheme.warningAmber
        case .critical: return SkyTheme.criticalRed
        }
    }
    
    private var statusDescription: String {
        switch fireService.currentState {
        case .normal: return "All sensors reporting within safe ambient thresholds."
        case .possibleSmoke: return "Combustion gas reading elevated above calibrated baseline."
        case .flameDetected: return "Optical infrared flame sensor triggered."
        case .highTemperature: return "Ambient air temperature exceeds safe operational limit."
        case .multiSensorAlert: return "Confirmed fire hazard: Flame sensor correlated with smoke/heat."
        case .sensorError: return "Sensor readings unavailable or disconnected."
        case .communicationLost: return "Telemetry link interrupted or stale."
        }
    }
}
