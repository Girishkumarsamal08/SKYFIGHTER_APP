import unittest
from detector import FireSmokeDetector

class TestFireSmokeDetector(unittest.TestCase):
    def setUp(self):
        self.detector = FireSmokeDetector(confidence_threshold=0.70)

    def test_low_confidence_rejected(self):
        res = self.detector.process_frame(
            rgb_detections=[{"class": "fire", "confidence": 0.55}] # Below 0.70
        )
        self.assertEqual(len(res), 0)

    def test_single_detection_is_potential(self):
        res = self.detector.process_frame(
            rgb_detections=[{"class": "fire", "confidence": 0.85, "box": {"x": 0.5, "y": 0.5, "width": 0.1, "height": 0.1}}],
            thermal_max_c=120.0,
            gps={"valid": True, "latitude": 12.9716, "longitude": 77.5946},
            now_ms=1000
        )
        self.assertEqual(len(res), 1)
        self.assertEqual(res[0]["status"], "potential")
        self.assertEqual(res[0]["frame_count"], 1)
        self.assertEqual(res[0]["gps_coords"]["latitude"], 12.9716)

    def test_multi_frame_promotes_to_repeated(self):
        t0 = 1000
        # Frame 1
        res1 = self.detector.process_frame(
            rgb_detections=[{"class": "fire", "confidence": 0.88, "box": {"x": 0.5, "y": 0.5, "width": 0.1, "height": 0.1}}],
            now_ms=t0
        )
        self.assertEqual(res1[0]["status"], "potential")

        # Frame 2
        res2 = self.detector.process_frame(
            rgb_detections=[{"class": "fire", "confidence": 0.90, "box": {"x": 0.51, "y": 0.5, "width": 0.1, "height": 0.1}}],
            now_ms=t0 + 200
        )
        self.assertEqual(res2[0]["status"], "potential")

        # Frame 3
        res3 = self.detector.process_frame(
            rgb_detections=[{"class": "fire", "confidence": 0.92, "box": {"x": 0.50, "y": 0.51, "width": 0.1, "height": 0.1}}],
            now_ms=t0 + 400
        )
        self.assertEqual(res3[0]["status"], "repeated")
        self.assertEqual(res3[0]["frame_count"], 3)

    def test_human_verification(self):
        res = self.detector.process_frame(
            rgb_detections=[{"class": "smoke", "confidence": 0.82, "box": {"x": 0.2, "y": 0.3, "width": 0.2, "height": 0.2}}],
            now_ms=1000
        )
        track_id = res[0]["id"]
        self.detector.verify_incident(track_id)
        
        # Next frame reflects human_verified
        res2 = self.detector.process_frame(
            rgb_detections=[{"class": "smoke", "confidence": 0.85, "box": {"x": 0.2, "y": 0.3, "width": 0.2, "height": 0.2}}],
            now_ms=1200
        )
        self.assertEqual(res2[0]["status"], "human_verified")

if __name__ == '__main__':
    unittest.main()
