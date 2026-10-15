import Foundation

public protocol DroneTransportDelegate: AnyObject, Sendable {
    func transportDidConnect(transportName: String)
    func transportDidDisconnect(error: Error?)
    func transportDidReceiveData(_ data: Data)
}

public protocol DroneTransport: AnyObject, Sendable {
    var delegate: (any DroneTransportDelegate)? { get set }
    var isConnected: Bool { get }
    var transportName: String { get }
    
    func connect(config: ConnectionConfig) async throws
    func disconnect() async
    func send(data: Data) async throws
}
