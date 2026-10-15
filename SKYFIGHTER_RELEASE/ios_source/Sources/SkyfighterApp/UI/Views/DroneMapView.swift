import SwiftUI
import MapKit

public struct DroneMapView: View {
    @ObservedObject public var connectionManager: DroneConnectionManager
    @ObservedObject public var fireService: FireMonitoringService
    
    // Explicitly tracked home location (nil until set by pilot or valid arming position)
    @State private var homeCoordinate: CLLocationCoordinate2D?
    @State private var droneTrail: [CLLocationCoordinate2D] = []
    
    public init(connectionManager: DroneConnectionManager, fireService: FireMonitoringService) {
        self.connectionManager = connectionManager
        self.fireService = fireService
    }
    
    private var telemetry: TelemetryPacket {
        connectionManager.telemetry
    }
    
    private var hasValidGPS: Bool {
        telemetry.gps.valid && telemetry.gps.latitude != nil && telemetry.gps.longitude != nil
    }
    
    private var currentCoordinate: CLLocationCoordinate2D? {
        guard hasValidGPS, let lat = telemetry.gps.latitude, let lon = telemetry.gps.longitude else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }
    
    public var body: some View {
        ZStack(alignment: .top) {
            // Native MapKit Map
            if let coord = currentCoordinate {
                Map {
                    // Drone Current Marker
                    Annotation("SKYFIGHTER", coordinate: coord) {
                        ZStack {
                            Circle()
                                .fill(SkyTheme.accentCyan.opacity(0.3))
                                .frame(width: 48, height: 48)
                            Circle()
                                .fill(SkyTheme.accentCyan)
                                .frame(width: 22, height: 22)
                            Image(systemName: "airplane")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundColor(.black)
                        }
                    }
                    
                    // Home Location (if explicitly set)
                    if let home = homeCoordinate {
                        Annotation("Home Point", coordinate: home) {
                            ZStack {
                                Circle().fill(SkyTheme.normalGreen).frame(width: 26, height: 26)
                                Image(systemName: "house.fill")
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundColor(.white)
                            }
                        }
                    }
                    
                    // Fire Alert Markers
                    ForEach(fireService.eventHistory.filter { $0.latitude != nil && $0.longitude != nil }) { event in
                        Annotation(event.state.rawValue, coordinate: CLLocationCoordinate2D(latitude: event.latitude!, longitude: event.longitude!)) {
                            ZStack {
                                Circle().fill(SkyTheme.criticalRed).frame(width: 24, height: 24)
                                Image(systemName: "flame.fill")
                                    .font(.system(size: 12))
                                    .foregroundColor(.white)
                            }
                        }
                    }
                }
                .mapStyle(.imagery(elevation: .realistic))
                .ignoresSafeArea()
            } else {
                // No GPS Fix View
                VStack(spacing: 16) {
                    Image(systemName: "location.slash.fill")
                        .font(.system(size: 54))
                        .foregroundColor(SkyTheme.warningAmber)
                    
                    Text("No GPS Fix Available")
                        .font(.title3.bold())
                        .foregroundColor(SkyTheme.textPrimary)
                    
                    Text("Waiting for NEO-6M GPS module to acquire satellite lock. Real coordinates will appear here once valid 3D fix is confirmed.")
                        .font(.footnote)
                        .multilineTextAlignment(.center)
                        .foregroundColor(SkyTheme.textSecondary)
                        .padding(.horizontal, 32)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(SkyTheme.background.ignoresSafeArea())
            }
            
            // Top HUD Overlay
            VStack(spacing: 8) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("TACTICAL MAP")
                            .font(.system(size: 16, weight: .black, design: .monospaced))
                            .foregroundColor(SkyTheme.textPrimary)
                        if hasValidGPS, let coord = currentCoordinate {
                            Text(String(format: "LAT: %.5f  LON: %.5f", coord.latitude, coord.longitude))
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundColor(SkyTheme.accentCyan)
                        } else {
                            Text("GPS: UNLOCKED")
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundColor(SkyTheme.warningAmber)
                        }
                    }
                    Spacer()
                    
                    // Set Current Location as Home Button
                    if let coord = currentCoordinate {
                        Button(action: {
                            homeCoordinate = coord
                        }) {
                            HStack(spacing: 4) {
                                Image(systemName: "mappin.and.ellipse")
                                Text("Set Home")
                                    .font(.caption2.bold())
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(SkyTheme.panelBackground.opacity(0.9))
                            .foregroundColor(SkyTheme.normalGreen)
                            .clipShape(Capsule())
                        }
                    }
                }
                .padding(12)
                .background(SkyTheme.panelBackground.opacity(0.85))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(SkyTheme.panelBorder, lineWidth: 1)
                )
                .padding(.horizontal, 16)
                .padding(.top, 8)
                
                Spacer()
            }
        }
    }
}
