import unittest
import math
from flight_sim import DronePhysicsSimulator

class TestDroneSimulation(unittest.TestCase):
    def setUp(self):
        self.sim = DronePhysicsSimulator()

    def test_disarmed_throttle_stays_zero(self):
        self.sim.is_armed = False
        self.sim.set_control_inputs(0.5, 0.5, 0.0, 0.8) # 80% throttle while disarmed
        self.sim.update(0.1)
        self.assertEqual(self.sim.throttle, 0.0)
        self.assertEqual(self.sim.z, 0.0)

    def test_armed_flight_ascends(self):
        self.sim.is_armed = True
        self.sim.set_control_inputs(0.0, 0.0, 0.0, 0.8) # 80% throttle armed
        for _ in range(20):
            self.sim.update(0.1) # 2.0 seconds of flight
        self.assertGreater(self.sim.z, 1.0)
        self.assertGreater(self.sim.vz, 0.0)

    def test_wgs84_coords(self):
        lat, lon, alt = self.sim.get_wgs84_coords()
        self.assertAlmostEqual(lat, self.sim.home_lat, places=4)
        self.assertAlmostEqual(lon, self.sim.home_lon, places=4)
        self.assertGreaterEqual(alt, 24.5)

    def test_fire_proximity_triggers_sensors(self):
        # Move drone right into the fire hotspot (120, 180)
        self.sim.x = 120.0
        self.sim.y = 180.0
        self.sim.is_armed = True
        self.sim.update(0.1)
        
        # Temp should be high, MQ-2 high
        self.assertGreater(self.sim.ambient_temp_c, 50.0)
        self.assertGreater(self.sim.mq2_adc, 1000)

    def test_telemetry_schema(self):
        pkt = self.sim.generate_telemetry_packet(sequence=42)
        self.assertEqual(pkt["version"], 1)
        self.assertEqual(pkt["type"], "telemetry")
        self.assertEqual(pkt["sequence"], 42)
        self.assertIn("flight", pkt)
        self.assertIn("sensors", pkt)
        self.assertIn("gps", pkt)
        self.assertIn("battery", pkt)
        self.assertIsNone(pkt["battery"]["voltage_v"]) # Honest unwired battery check

if __name__ == '__main__':
    unittest.main()
