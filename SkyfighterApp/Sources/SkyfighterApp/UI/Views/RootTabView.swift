import SwiftUI

public struct RootTabView: View {
    @StateObject private var connectionManager = DroneConnectionManager()
    @StateObject private var controllerManager = GameControllerManager()
    @StateObject private var fireService = FireMonitoringService()
    @StateObject private var missionService = MissionService()
    
    @State private var selectedTab: Int = 0
    
    public init() {}
    
    public var body: some View {
        TabView(selection: $selectedTab) {
            DashboardView(connectionManager: connectionManager, fireService: fireService)
                .tabItem {
                    Label("Dashboard", systemImage: "gauge.with.needle.fill")
                }
                .tag(0)
            
            ManualControlView(connectionManager: connectionManager, controllerManager: controllerManager)
                .tabItem {
                    Label("Manual", systemImage: "airplane")
                }
                .tag(1)
            
            GameControllerView(controllerManager: controllerManager)
                .tabItem {
                    Label("Controller", systemImage: "gamecontroller.fill")
                }
                .tag(2)
            
            MissionView(missionService: missionService, connectionManager: connectionManager)
                .tabItem {
                    Label("Missions", systemImage: "point.topleft.down.to.point.bottomright.curvepath.fill")
                }
                .tag(3)
            
            DroneMapView(connectionManager: connectionManager, fireService: fireService)
                .tabItem {
                    Label("Map", systemImage: "map.fill")
                }
                .tag(4)
            
            FireAlertView(fireService: fireService, connectionManager: connectionManager)
                .tabItem {
                    Label("Fire Alert", systemImage: "flame.fill")
                }
                .tag(5)
            
            ConnectionView(connectionManager: connectionManager)
                .tabItem {
                    Label("Link", systemImage: "antenna.radiowaves.left.and.right")
                }
                .tag(6)
        }
        .tint(SkyTheme.accentCyan)
        .onAppear {
            // Apply dark theme styling to UITabBar
            #if os(iOS)
            let appearance = UITabBarAppearance()
            appearance.configureWithOpaqueBackground()
            appearance.backgroundColor = UIColor(SkyTheme.panelBackground)
            UITabBar.appearance().standardAppearance = appearance
            UITabBar.appearance().scrollEdgeAppearance = appearance
            #endif
        }
    }
}
