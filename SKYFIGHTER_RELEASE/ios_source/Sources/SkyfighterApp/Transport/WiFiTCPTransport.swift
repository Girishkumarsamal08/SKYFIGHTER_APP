import Foundation
import Network

public final class WiFiTCPTransport: DroneTransport, @unchecked Sendable {
    public weak var delegate: (any DroneTransportDelegate)?
    public private(set) var isConnected: Bool = false
    public let transportName: String = "Raw TCP (Network.framework)"
    
    private var connection: NWConnection?
    private let queue = DispatchQueue(label: "com.skyfighter.tcp.queue")
    private let lock = NSLock()
    
    public init() {}
    
    public func connect(config: ConnectionConfig) async throws {
        await disconnect()
        
        let host = NWEndpoint.Host(config.host)
        guard let port = NWEndpoint.Port(rawValue: UInt16(config.port)) else {
            throw NSError(domain: "SkyfighterTCP", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid port \(config.port)"])
        }
        
        let conn = NWConnection(host: host, port: port, using: .tcp)
        self.connection = conn
        
        final class ContinuationBox: @unchecked Sendable {
            private var continuation: CheckedContinuation<Void, Error>?
            private let lock = NSLock()
            
            init(_ continuation: CheckedContinuation<Void, Error>) {
                self.continuation = continuation
            }
            
            func resume() {
                lock.lock()
                let cont = continuation
                continuation = nil
                lock.unlock()
                cont?.resume()
            }
            
            func resume(throwing error: Error) {
                lock.lock()
                let cont = continuation
                continuation = nil
                lock.unlock()
                cont?.resume(throwing: error)
            }
        }
        
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let box = ContinuationBox(continuation)
            
            conn.stateUpdateHandler = { [weak self] state in
                guard let self = self else { return }
                switch state {
                case .ready:
                    self.setIsConnected(true)
                    box.resume()
                    self.delegate?.transportDidConnect(transportName: self.transportName)
                    self.receiveLoop()
                    
                case .failed(let error):
                    self.setIsConnected(false)
                    box.resume(throwing: error)
                    self.delegate?.transportDidDisconnect(error: error)
                    
                case .cancelled:
                    self.setIsConnected(false)
                    self.delegate?.transportDidDisconnect(error: nil)
                    
                default:
                    break
                }
            }
            
            conn.start(queue: self.queue)
        }
    }
    
    public func disconnect() async {
        let conn = clearConnection()
        conn?.cancel()
    }
    
    private func setIsConnected(_ value: Bool) {
        lock.lock()
        defer { lock.unlock() }
        isConnected = value
    }
    
    private func clearConnection() -> NWConnection? {
        lock.lock()
        defer { lock.unlock() }
        let conn = connection
        connection = nil
        isConnected = false
        return conn
    }
    
    public func send(data: Data) async throws {
        guard isConnected, let conn = connection else {
            throw NSError(domain: "SkyfighterTCP", code: -1, userInfo: [NSLocalizedDescriptionKey: "TCP Connection is closed."])
        }
        
        // Append newline delimiter for line-buffered UART parsers on ESP32
        var payload = data
        if payload.last != 0x0A {
            payload.append(0x0A)
        }
        
        return try await withCheckedThrowingContinuation { continuation in
            conn.send(content: payload, completion: .contentProcessed { error in
                if let error = error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            })
        }
    }
    
    private func receiveLoop() {
        guard isConnected, let conn = connection else { return }
        
        conn.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] content, _, isComplete, error in
            guard let self = self else { return }
            
            if let data = content, !data.isEmpty {
                self.delegate?.transportDidReceiveData(data)
            }
            
            if isComplete || error != nil {
                self.setIsConnected(false)
                self.delegate?.transportDidDisconnect(error: error)
            } else if self.isConnected {
                self.receiveLoop()
            }
        }
    }
}
