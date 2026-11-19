import json
import unittest
from pathlib import Path

from backend.main import CircuitAnalysis, flag_connectivity_issues


class ConnectivityReviewTests(unittest.TestCase):
    def setUp(self):
        fixture = Path(__file__).parent / "fixtures" / "duplicate_singleton_assignment_analysis.json"
        self.result = CircuitAnalysis.model_validate(json.loads(fixture.read_text(encoding="utf-8")))

    def test_defers_duplicate_singleton_without_mutating_electrical_evidence(self):
        evidence = self.result.model_dump()
        flag_connectivity_issues(self.result)
        self.assertFalse(self.result.reconstruction_incomplete)
        self.assertTrue(any("multiple reported nodes" in note for note in self.result.unclear_details))
        for key in ("nodes", "connections", "wires", "junctions"):
            self.assertEqual(self.result.model_dump()[key], evidence[key])

    def test_competing_populated_groups_remain_blocking(self):
        self.result.nodes[0].members.append("R2.A")
        flag_connectivity_issues(self.result)
        self.assertTrue(self.result.reconstruction_incomplete)

    def test_trace_errors_remain_blocking(self):
        self.result.wires[0].points = []
        flag_connectivity_issues(self.result)
        self.assertTrue(self.result.reconstruction_incomplete)
        self.assertTrue(any("no usable conductor span" in note for note in self.result.unclear_details))

    def test_preserves_model_incomplete_flag(self):
        self.result.reconstruction_incomplete = True
        flag_connectivity_issues(self.result)
        self.assertTrue(self.result.reconstruction_incomplete)

    def test_preserves_extracted_ohm_text_for_frontend_validation(self):
        fixture = Path(__file__).parent / "fixtures" / "corrupted_ohm_value_analysis.json"
        capture = json.loads(fixture.read_text(encoding="utf-8"))
        result = CircuitAnalysis.model_validate(capture)
        flag_connectivity_issues(result)
        self.assertEqual(
            {c.id: c.visible_value for c in result.components},
            {c["id"]: c["visible_value"] for c in capture["components"]},
        )
        self.assertFalse(result.reconstruction_incomplete)

    def test_preserves_all_three_corrupted_units_from_current_capture(self):
        fixture = Path(__file__).parent / "fixtures" / "combining_grave_resistance_analysis.json"
        result = CircuitAnalysis.model_validate_json(fixture.read_text(encoding="utf-8"))
        flag_connectivity_issues(result)
        self.assertEqual(
            [part.visible_value for part in result.components],
            ["18 V", "3 \u0300", "6 \u0300", "12 \u0300"],
        )
        self.assertFalse(result.reconstruction_incomplete)
