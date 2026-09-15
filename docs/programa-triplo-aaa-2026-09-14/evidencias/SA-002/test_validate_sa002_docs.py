#!/usr/bin/env python3
"""Regressões estruturais da documentação de SA-002."""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import validate_sa002_docs  # noqa: E402


ROOT = Path(__file__).resolve().parents[4]
PROGRAM = ROOT / "docs/programa-triplo-aaa-2026-09-14"
MANIFEST = PROGRAM / "evidencias/SA-002/candidate-manifest-r3.json"


class Sa002DocsTests(unittest.TestCase):
    def test_current_contract_decision_and_denominator_docs_are_complete(self) -> None:
        candidate = json.loads(MANIFEST.read_text())["candidate"]["id"]
        result = validate_sa002_docs.validate_repo(ROOT, MANIFEST, candidate)
        self.assertEqual([], result["errors"])
        self.assertTrue(result["valid"])

    def test_missing_contract_example_is_rejected(self) -> None:
        text = (PROGRAM / "CONTRATOS.md").read_text()
        broken = text.replace("| C10 | AC → teste/procedimento", "| X10 | AC → teste/procedimento")
        errors = validate_sa002_docs.validate_contracts(broken)
        self.assertTrue(any("exemplos esperados" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
