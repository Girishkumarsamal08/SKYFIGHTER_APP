import Foundation

public enum MissionType: String, CaseIterable, Codable, Sendable {
    case environmentalSurvey = "Environmental Survey"
    case forestFireObservation = "Forest Fire Observation"
    case waypointSurvey = "GPS Waypoint Mission"
    case returnToHome = "Return to Home (RTH)"
    
    public var icon: String {
        switch self {
        case .environmentalSurvey: return "leaf.arrow.triangle.circlepath"
        case .forestFireObservation: return "flame.fill"
        case .waypointSurvey: return "mappin.and.ellipse"
        case .returnToHome: return "house.fill"
        }
    }
    
    public var description: String {
        switch self {
        case .environmentalSurvey:
            return "Perimeter scan monitoring temperature, humidity, and gas levels."
        case .forestFireObservation:
            return "Targeted surveillance around suspected thermal hotspots and flame sensors."
        case .waypointSurvey:
            return "Autonomous transit through predetermined GPS coordinates."
        case .returnToHome:
            return "Autonomous return to recorded takeoff / home coordinate."
        }
    }
}

public enum MissionExecutionState: String, Codable, Sendable {
    case idle = "Idle"
    case ready = "Ready for Launch"
    case running = "Active Mission"
    case paused = "Paused"
    case returningHome = "Returning Home"
    case completed = "Completed"
    case aborted = "Aborted by Pilot"
    case rejectedCapability = "Capability Rejected"
}

public struct MissionWaypoint: Identifiable, Codable, Sendable, Equatable {
    public let id: UUID
    public var order: Int
    public var latitude: Double
    public var longitude: Double
    public var altitudeMeters: Double
    public var hoverDurationSeconds: Int
    
    public init(
        id: UUID = UUID(),
        order: Int,
        latitude: Double,
        longitude: Double,
        altitudeMeters: Double = 15.0,
        hoverDurationSeconds: Int = 5
    ) {
        self.id = id
        self.order = order
        self.latitude = latitude
        self.longitude = longitude
        self.altitudeMeters = altitudeMeters
        self.hoverDurationSeconds = hoverDurationSeconds
    }
}

public struct MissionTimelineEvent: Identifiable, Codable, Sendable {
    public let id: UUID
    public let timestamp: Date
    public let title: String
    public let detail: String
    public let severity: AlertSeverity
    
    public init(
        id: UUID = UUID(),
        timestamp: Date = Date(),
        title: String,
        detail: String,
        severity: AlertSeverity = .info
    ) {
        self.id = id
        self.timestamp = timestamp
        self.title = title
        self.detail = detail
        self.severity = severity
    }
}

public struct MissionPlan: Identifiable, Codable, Sendable {
    public let id: UUID
    public var name: String
    public var type: MissionType
    public var waypoints: [MissionWaypoint]
    public var maxAltitudeMeters: Double
    public var failsafeAction: String
    
    public init(
        id: UUID = UUID(),
        name: String = "Fire Perimeter Recon",
        type: MissionType = .forestFireObservation,
        waypoints: [MissionWaypoint] = [],
        maxAltitudeMeters: Double = 30.0,
        failsafeAction: String = "Hover & Land"
    ) {
        self.id = id
        self.name = name
        self.type = type
        self.waypoints = waypoints
        self.maxAltitudeMeters = maxAltitudeMeters
        self.failsafeAction = failsafeAction
    }
}
