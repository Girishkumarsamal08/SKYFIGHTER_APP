import Foundation

public enum TelemetryParsingError: LocalizedError, Equatable {
    case invalidJSON(String)
    case unsupportedVersion(Int)
    case missingType
    case staleData(ageSeconds: Double)
    
    public var errorDescription: String? {
        switch self {
        case .invalidJSON(let reason):
            return "Failed to decode telemetry JSON: \(reason)"
        case .unsupportedVersion(let v):
            return "Unsupported telemetry schema version \(v). Expected version 1."
        case .missingType:
            return "Packet missing 'type' field or type is not 'telemetry'."
        case .staleData(let age):
            return "Telemetry data is stale (\(String(format: "%.1f", age))s old)."
        }
    }
}

public struct TelemetryParser: Sendable {
    public static let supportedVersion = 1
    
    private let decoder: JSONDecoder
    
    public init() {
        let dec = JSONDecoder()
        self.decoder = dec
    }
    
    /// Parses raw JSON Data into a validated `TelemetryPacket`.
    public func parse(data: Data, maxAllowedAgeSeconds: Double? = nil) throws -> TelemetryPacket {
        let packet: TelemetryPacket
        do {
            packet = try decoder.decode(TelemetryPacket.self, from: data)
        } catch {
            throw TelemetryParsingError.invalidJSON(error.localizedDescription)
        }
        
        guard packet.version == Self.supportedVersion else {
            throw TelemetryParsingError.unsupportedVersion(packet.version)
        }
        
        guard packet.type == "telemetry" else {
            throw TelemetryParsingError.missingType
        }
        
        // Freshness verification if maxAllowedAgeSeconds is specified
        if let maxAge = maxAllowedAgeSeconds, packet.timestampMs > 0 {
            let nowMs = UInt64(Date().timeIntervalSince1970 * 1000)
            if nowMs > packet.timestampMs {
                let ageSeconds = Double(nowMs - packet.timestampMs) / 1000.0
                if ageSeconds > maxAge {
                    throw TelemetryParsingError.staleData(ageSeconds: ageSeconds)
                }
            }
        }
        
        return packet
    }
}
