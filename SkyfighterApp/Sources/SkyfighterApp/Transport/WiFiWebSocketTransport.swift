import Foundation

public final class WiFiWebSocketTransport: DroneTransport, @unchecked Sendable {
    public weak var delegate: (any DroneTransportDelegate)?
    public private(set) var isConnected: Bool = false
    public let transportName: String = "WebSocket (ws://)"
    
    private var webSocketTask: URLSessionWebSocketTask?
    private var session: URLSession?
    private var isListening = false
    private let lock = NSLock()
    
    public init() {}
    
    public func connect(config: ConnectionConfig) async throws {
        await disconnect()
        
        guard let url = URL(string: "ws://\(config.host):\(config.port)/telemetry") else {
            throw URLError(.badURL)
        }
        
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = config.telemetryTimeoutSeconds
        let session = URLSession(configuration: configuration)
        self.session = session
        
        let task = session.webSocketTask(with: url)
        self.webSocketTask = task
        task.resume()
        
        setConnectedState(connected: true, listening: true)
        
        delegate?.transportDidConnect(transportName: transportName)
        listenNextMessage()
    }
    
    public func disconnect() async {
        let (task, sess) = clearSessionAndTask()
        task?.cancel(with: .normalClosure, reason: nil)
        sess?.invalidateAndCancel()
        
        delegate?.transportDidDisconnect(error: nil)
    }
    
    private func setConnectedState(connected: Bool, listening: Bool) {
        lock.lock()
        defer { lock.unlock() }
        self.isConnected = connected
        self.isListening = listening
    }
    
    private func clearSessionAndTask() -> (URLSessionWebSocketTask?, URLSession?) {
        lock.lock()
        defer { lock.unlock() }
        isListening = false
        isConnected = false
        let task = webSocketTask
        webSocketTask = nil
        let sess = session
        session = nil
        return (task, sess)
    }
    
    public func send(data: Data) async throws {
        guard isConnected, let task = webSocketTask else {
            throw NSError(domain: "SkyfighterTransport", code: -1, userInfo: [NSLocalizedDescriptionKey: "WebSocket is not connected."])
        }
        
        let message = URLSessionWebSocketTask.Message.data(data)
        try await task.send(message)
    }
    
    private func listenNextMessage() {
        guard isListening, let task = webSocketTask else { return }
        
        task.receive { [weak self] result in
            guard let self = self, self.isListening else { return }
            
            switch result {
            case .success(let message):
                let data: Data
                switch message {
                case .data(let d):
                    data = d
                case .string(let s):
                    data = Data(s.utf8)
                @unknown default:
                    data = Data()
                }
                
                self.delegate?.transportDidReceiveData(data)
                self.listenNextMessage()
                
            case .failure(let error):
                self.setConnectedState(connected: false, listening: false)
                self.delegate?.transportDidDisconnect(error: error)
            }
        }
    }
}
