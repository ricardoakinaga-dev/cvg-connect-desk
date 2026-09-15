#!/usr/bin/env python3
"""Valida a topologia documental de SA-002/AC1–AC3.

Este verificador não certifica o produto. Ele fecha apenas a prova estrutural
de que os contratos, gates, decisões e denominadores congelados continuam
completos e ligados ao candidato informado.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


DEFAULT_ROOT = Path(__file__).resolve().parents[4]
PROGRAM = Path("docs/programa-triplo-aaa-2026-09-14")
DEFAULT_MANIFEST = PROGRAM / "evidencias/SA-002/candidate-manifest-r3.json"


def markdown_rows(text: str, prefix: str) -> list[list[str]]:
    rows: list[list[str]] = []
    pattern = re.compile(rf"^\|\s*({prefix}\d{{2}})(?:\s+—[^|]*)?\s*\|")
    for line in text.splitlines():
        if not pattern.match(line):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        rows.append(cells)
    return rows


def ids(rows: list[list[str]]) -> list[str]:
    return [re.match(r"([A-Z]+\d{2})", row[0]).group(1) for row in rows if row]


def validate_contracts(text: str) -> list[str]:
    errors: list[str] = []
    main = text.split("## Exemplos obrigatórios", 1)[0]
    contract_rows = markdown_rows(main, "C")
    expected = [f"C{i:02d}" for i in range(1, 11)]
    if ids(contract_rows) != expected:
        errors.append(f"CONTRATOS: IDs principais esperados {expected}, obtidos {ids(contract_rows)}")
    if any(len(row) < 5 or any(not cell for cell in row[1:5]) for row in contract_rows):
        errors.append("CONTRATOS: cada C01–C10 precisa de dono, invariante, entrada/saída e consumidores")

    example_section = text.split("## Matriz de exemplos por contrato", 1)
    if len(example_section) != 2:
        return errors + ["CONTRATOS: falta a matriz explícita de exemplos de sucesso/erro"]
    example_text = example_section[1].split("## Denominadores congelados", 1)[0]
    examples = markdown_rows(example_text, "C")
    if ids(examples) != expected:
        errors.append(f"CONTRATOS: exemplos esperados {expected}, obtidos {ids(examples)}")
    if any(len(row) < 4 or any(not cell for cell in row[1:4]) for row in examples):
        errors.append("CONTRATOS: cada exemplo precisa de sucesso, erro e consumidor/prova")
    return errors


def validate_criteria(text: str) -> list[str]:
    errors: list[str] = []
    section = text.split("## Gates — versão", 1)
    if len(section) != 2:
        return ["CRITERIOS: falta seção de gates versionada"]
    gate_text = section[1].split("## Matriz de consumidores e exemplos dos gates", 1)[0]
    rows = markdown_rows(gate_text, "G")
    expected = [f"G{i:02d}" for i in range(1, 13)]
    if ids(rows) != expected:
        errors.append(f"CRITERIOS: gates esperados {expected}, obtidos {ids(rows)}")
    if any(len(row) < 5 or any(not cell for cell in row[1:5]) for row in rows):
        errors.append("CRITERIOS: cada gate precisa de dono, entradas, saída e reprovação")
    consumer_section = text.split("## Matriz de consumidores e exemplos dos gates", 1)
    if len(consumer_section) != 2:
        errors.append("CRITERIOS: falta matriz de consumidor/sucesso/erro dos gates")
    else:
        consumer_text = consumer_section[1].split("## Orçamentos preservados", 1)[0]
        consumer_rows = markdown_rows(consumer_text, "G")
        if ids(consumer_rows) != expected:
            errors.append(f"CRITERIOS: consumidores/exemplos esperados {expected}, obtidos {ids(consumer_rows)}")
        if any(len(row) < 4 or any(not cell for cell in row[1:4]) for row in consumer_rows):
            errors.append("CRITERIOS: cada gate precisa de consumidor, sucesso e erro")
    for marker in ("## Denominadores congelados", "Coverage", "Workload", "Matriz visual", "Método de nota"):
        if marker not in text:
            errors.append(f"CRITERIOS: denominador/método ausente: {marker}")
    return errors


def validate_decisions(text: str) -> list[str]:
    errors: list[str] = []
    rows = markdown_rows(text.split("## Registro de fechamento", 1)[0], "D")
    expected = [f"D{i:02d}" for i in range(1, 7)]
    if ids(rows) != expected:
        errors.append(f"DECISOES: decisões esperadas {expected}, obtidas {ids(rows)}")
    if any(len(row) < 8 or any(not cell for cell in row[1:8]) for row in rows):
        errors.append("DECISOES: cada D01–D06 precisa de proposta, alternativa, impacto, subações, preparo, autoridade e limite")
    if "Status atual de todas as decisões: OPEN" not in text:
        errors.append("DECISOES: estado OPEN não está explícito")
    return errors


def validate_denominators(data: dict) -> list[str]:
    errors: list[str] = []
    coverage = data.get("coverage", {})
    thresholds = coverage.get("scope_thresholds", {})
    for scope in ("shared", "core", "domain", "api", "web", "global"):
        if scope not in thresholds:
            errors.append(f"denominadores: threshold ausente para {scope}")
    if coverage.get("metric_order") != ["statements", "branches", "functions", "lines"]:
        errors.append("denominadores: ordem provider v8 divergente")
    workload = data.get("workload", {}).get("dataset", {})
    if workload != {"conversations": 10000, "messages": 100000, "sessions": 100}:
        errors.append("denominadores: dataset de workload reduzido/divergente")
    profile = data.get("workload", {}).get("profile", {})
    if profile != {"warmup_minutes": 10, "measure_minutes": 30, "rounds": 3}:
        errors.append("denominadores: perfil de workload divergente")
    visual = data.get("visual_matrix", {})
    if len(visual.get("routes", [])) != 16 or len(visual.get("viewports", [])) != 5:
        errors.append("denominadores: matriz visual não é 16×5")
    scoring = data.get("scoring_method", {})
    if "40%" not in scoring.get("general_formula", "") or "48" not in scoring.get("individual_rule", ""):
        errors.append("denominadores: método de nota não congela pesos e itens")
    return errors


def validate_repo(repo: Path, manifest_path: Path, expected_candidate: str | None = None) -> dict:
    program = repo / PROGRAM
    manifest = json.loads(manifest_path.read_text())
    candidate = manifest["candidate"]["id"]
    errors: list[str] = []
    if expected_candidate and candidate != expected_candidate:
        errors.append(f"candidato divergente: {candidate} != {expected_candidate}")

    errors.extend(validate_contracts((program / "CONTRATOS.md").read_text()))
    errors.extend(validate_criteria((program / "CRITERIOS.md").read_text()))
    errors.extend(validate_decisions((program / "DECISOES.md").read_text()))
    denominators = json.loads((program / "evidencias/SA-002/frozen-denominators.json").read_text())
    errors.extend(validate_denominators(denominators))

    requirements = json.loads((program / "REQUISITOS.json").read_text())["requirements"]
    traceability = (program / "RASTREABILIDADE.md").read_text()
    missing = [item["id"] for item in requirements if item["id"] not in traceability]
    if len(requirements) != 59 or missing:
        errors.append(f"rastreabilidade: requisitos={len(requirements)}, ausentes={missing}")
    if denominators.get("candidate_id") != candidate:
        errors.append("denominadores: candidate_id não acompanha o manifesto atual")

    return {
        "valid": not errors,
        "candidate_id": candidate,
        "contract_count": 10,
        "gate_count": 12,
        "decision_count": 6,
        "requirement_count": len(requirements),
        "errors": errors,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default=str(DEFAULT_ROOT))
    parser.add_argument("--manifest", default=str(DEFAULT_MANIFEST))
    parser.add_argument("--candidate-id")
    args = parser.parse_args()
    result = validate_repo(Path(args.repo).resolve(), Path(args.manifest).resolve(), args.candidate_id)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["valid"] else 1


if __name__ == "__main__":
    sys.exit(main())
