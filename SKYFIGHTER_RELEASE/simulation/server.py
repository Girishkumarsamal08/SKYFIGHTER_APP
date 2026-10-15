"""
SKYFIGHTER — Python Gateway & Flight Simulation WebSocket Server
Acts as ESP32 #2 Gateway replacement for ground testing, CI/CD, and simulation.
"""

import sys
import os
import asyncio
import json
import logging
from typing import Set

import websockets

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from simulation.flight_sim import DronePhysicsSimulator
from shared.protocol.protocol import (
    PROTOCOL_VERSION,
    parse_incoming_packet,
    sanitize_manual_input,
    RateLimiter,
    SequenceValidator,
    ProtocolError
)

logging.basicConfig(level=logging.INFO, format='[SIM-GATEWAY] %(asctime)s - %(message)s')
logger = logging.getLogger(__name__)

class SimulationGatewayServer:
    def __init__(self, host="0.0.0.0", port=8080):
        self.host = host
        self.port = port
        self.drone = DronePhysicsSimulator()
        self.clients: Set[websockets.WebSocketServerProtocol] = set()
        self.sequence = 0
        self.rate_limiter = RateLimiter(20.0)
        self.seq_validator = SequenceValidator()
        self.active_lease_owner = None
        self.lease_expires_at = 0.0

    async def register(self, websocket):
        self.clients.add(websocket)
        logger.info(f"Client connected: {websocket.remote_address}. Total clients: {len(self.clients)}")

        # Send greeting capability manifest
        manifest = {
            "version": PROTOCOL_VERSION,
            "type": "manifest",
            "timestamp_ms": int(asyncio.get_event_loop().time() * 1000),
            "gateway": "PYTHON_SIMULATION_GATEWAY_V1.1",
            "capabilities": {
                "manual_control": False,
                "autonomous_navigation": False,
                "return_to_home": False,
                "simulation_mode": True
            }
        }
        await websocket.send(json.dumps(manifest))

    async def unregister(self, websocket):
        self.clients.discard(websocket)
        logger.info(f"Client disconnected: {websocket.remote_address}. Remaining: {len(self.clients)}")

    async def handle_command(self, websocket, message_str):
        try:
            packet = parse_incoming_packet(message_str)
            cmd_type = packet.get("type")
            client_id = packet.get("client_id", "ANONYMOUS")
            seq = packet.get("sequence", 0)

            # Emergency Stop (Always executed regardless of lease)
            if cmd_type == "emergency_stop":
                self.drone.is_armed = False
                self.drone.set_control_inputs(0.0, 0.0, 0.0, 0.0)
                logger.warning(f"EMERGENCY MOTOR CUT by client {client_id}")
                ack = {
                    "version": PROTOCOL_VERSION,
                    "type": "ack",
                    "sequence": seq,
                    "status": "executed",
                    "code": "ESTOP_TRIGGERED",
                    "message": "Motors disarmed immediately."
                }
                await websocket.send(json.dumps(ack))
                return

            # Control lease handling
            now = asyncio.get_event_loop().time()
            if cmd_type == "control_claim":
                action = packet.get("action")
                if action == "request_lease":
                    if not self.active_lease_owner or now > self.lease_expires_at or self.active_lease_owner == client_id:
                        self.active_lease_owner = client_id
                        self.lease_expires_at = now + 4.0
                        ack = {"version": 1, "type": "ack", "sequence": seq, "status": "accepted", "code": "LEASE_GRANTED"}
                        logger.info(f"Control lease granted to {client_id}")
                    else:
                        ack = {"version": 1, "type": "ack", "sequence": seq, "status": "rejected", "code": "LEASE_BUSY"}
                elif action == "heartbeat":
                    if self.active_lease_owner == client_id:
                        self.lease_expires_at = now + 4.0
                        ack = {"version": 1, "type": "ack", "sequence": seq, "status": "accepted", "code": "HEARTBEAT_OK"}
                    else:
                        ack = {"version": 1, "type": "ack", "sequence": seq, "status": "rejected", "code": "LEASE_EXPIRED"}
                await websocket.send(json.dumps(ack))
                return

            # Arm / Disarm Command
            if cmd_type == "arm_command":
                arm = packet.get("arm", False)
                token = packet.get("confirmation_token", "")
                if len(token) >= 8:
                    self.drone.is_armed = arm
                    logger.info(f"Drone armed state set to {arm} by {client_id}")
                    ack = {"version": 1, "type": "ack", "sequence": seq, "status": "accepted", "code": "ARM_STATE_CHANGED"}
                else:
                    ack = {"version": 1, "type": "ack", "sequence": seq, "status": "rejected", "code": "INVALID_TOKEN"}
                await websocket.send(json.dumps(ack))
                return

            # Manual stick command
            if cmd_type == "manual_command":
                r = packet.get("roll", 0.0)
                p = packet.get("pitch", 0.0)
                y = packet.get("yaw", 0.0)
                t = packet.get("throttle", 0.0)
                self.drone.set_control_inputs(r, p, y, t)
                ack = {"version": 1, "type": "ack", "sequence": seq, "status": "accepted", "code": "STICKS_UPDATED"}
                await websocket.send(json.dumps(ack))
                return

        except ProtocolError as pe:
            ack = {"version": 1, "type": "ack", "sequence": 0, "status": "rejected", "code": pe.code, "message": str(pe)}
            await websocket.send(json.dumps(ack))
        except Exception as e:
            logger.error(f"Error handling command: {e}")

    async def ws_handler(self, websocket, path):
        await self.register(websocket)
        try:
            async for message in websocket:
                await self.handle_command(websocket, message)
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            await self.unregister(websocket)

    async def simulation_loop(self):
        dt = 0.05 # 20 Hz physics update
        telemetry_interval = 0.5 # 2 Hz broadcast
        last_broadcast = 0.0

        while True:
            t0 = asyncio.get_event_loop().time()
            self.drone.update(dt)

            if t0 - last_broadcast >= telemetry_interval:
                last_broadcast = t0
                self.sequence += 1
                pkt = self.drone.generate_telemetry_packet(self.sequence)
                pkt_json = json.dumps(pkt)

                if self.clients:
                    await asyncio.gather(
                        *[client.send(pkt_json) for client in self.clients],
                        return_exceptions=True
                    )

            await asyncio.sleep(dt)

    async def start(self):
        logger.info(f"Starting SKYFIGHTER Simulation Gateway on ws://{self.host}:{self.port}/telemetry")
        server = await websockets.serve(self.ws_handler, self.host, self.port)
        await self.simulation_loop()

if __name__ == "__main__":
    gw = SimulationGatewayServer()
    try:
        asyncio.run(gw.start())
    except KeyboardInterrupt:
        logger.info("Simulation server stopped.")
