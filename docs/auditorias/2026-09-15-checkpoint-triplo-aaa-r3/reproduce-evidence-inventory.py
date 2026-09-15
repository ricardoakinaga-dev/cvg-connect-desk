#!/usr/bin/env python3
"""Reproduz o inventário estrutural das 17 promoções reabertas na R3."""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
PROGRAM = REPO / "docs/programa-triplo-aaa-2026-09-14"
TASK_IDS = {f"SA-{number:03d}" for number in range(1, 16)} | {"SA-019", "SA-020"}
ENTRY_CANDIDATE = "754f9badac46278e77d21de91c58eedb15e80581+worktree#c486a63f161da313"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


backlog = json.loads((PROGRAM / "BACKLOG.json").read_text())
tasks = [task for task in backlog["tasks"] if task["id"] in TASK_IDS]
references: list[dict] = []
records: list[dict] = []

for task in tasks:
    for evidence in task.get("evidence", []):
        path = PROGRAM / evidence["path"]
        actual = sha256(path) if path.is_file() else None
        references.append(
            {
                "task_id": task["id"],
                "path": evidence["path"],
                "declared_sha256": evidence["sha256"],
                "actual_sha256": actual,
                "valid": actual == evidence["sha256"],
            }
        )

    evidence_log = PROGRAM / task["evidence_dir"] / "evidence.jsonl"
    if evidence_log.is_file():
        for line_number, line in enumerate(evidence_log.read_text().splitlines(), 1):
            if not line.strip():
                continue
            record = json.loads(line)
            records.append(
                {
                    "task_id": task["id"],
                    "line": line_number,
                    "candidate_id": record.get("candidate_id"),
                    "ac": record.get("ac"),
                    "reviewer": record.get("reviewer"),
                }
            )

candidates = Counter(str(record["candidate_id"]) for record in records)
exact = [record for record in records if record["candidate_id"] == ENTRY_CANDIDATE]
output = {
    "scope": sorted(TASK_IDS),
    "required_acceptance_count": sum(
        1 for task in tasks for acceptance in task["acceptance"] if acceptance.get("required", True)
    ),
    "current_reference_count": len(references),
    "entry_reference_count_reported_by_i1": 101,
    "post_entry_change": "Execuções concorrentes posteriores ao snapshot adicionaram 3 referências ao backlog e 17 registros JSONL ligados ao selo #128b1a64; o inventário corrente preserva essa evolução sem tratá-la como aprovação R3.",
    "missing_or_hash_mismatch": [reference for reference in references if not reference["valid"]],
    "jsonl_record_count": len(records),
    "candidate_distribution": dict(sorted(candidates.items())),
    "exact_entry_candidate_records": exact,
    "structural_conclusion": "Integridade de arquivo não comprova cobertura semântica dos aceites nem revisão I1 posterior.",
}
print(json.dumps(output, indent=2, ensure_ascii=False))
