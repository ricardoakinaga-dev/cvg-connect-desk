#!/usr/bin/env python3
"""Compara o manifesto fonte histórico com o candidato atual (SA-001/AC1)."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import candidate_manifest


def compare(baseline: dict[str, str], current: dict) -> dict:
    current_entries = {
        entry["path"]: entry for entry in current["inventory"]["entries"]
    }
    product_prefixes = tuple(current["seals"]["product"]["excluded_prefixes"])
    current_product = {
        path: entry
        for path, entry in current_entries.items()
        if not path.startswith(product_prefixes)
    }
    baseline_paths = set(baseline)
    current_paths = set(current_product)
    missing = sorted(baseline_paths - current_paths)
    changed = []
    unchanged = []
    for path in sorted(baseline_paths & current_paths):
        current_sha = current_product[path].get("sha256")
        item = {
            "path": path,
            "baseline_sha256": baseline[path],
            "current_sha256": current_sha,
            "git_state": current_product[path].get("git_state"),
            "status_code": current_product[path].get("status_code"),
        }
        if current_sha == baseline[path]:
            unchanged.append(path)
        else:
            changed.append(item)

    new_paths = sorted(current_paths - baseline_paths)
    worktree_attributed_changed = [
        item
        for item in changed
        if item["status_code"]
        or item["git_state"] == "untracked"
    ]
    unexplained_changed = [item for item in changed if item not in worktree_attributed_changed]
    review_required_new_worktree = [
        path
        for path in new_paths
        if current_product[path].get("status_code")
        or current_product[path].get("git_state") == "untracked"
    ]
    expected_scope_expansion = [
        path
        for path in new_paths
        if path not in review_required_new_worktree
        and current_product[path].get("git_state") == "tracked"
    ]
    unexplained_new = [
        path
        for path in new_paths
        if path not in review_required_new_worktree and path not in expected_scope_expansion
    ]
    expected_excluded = [
        path
        for path in missing
        if any(
            path.startswith(directory + "/")
            for directory in current["inventory"]["excluded_dirs"]
        )
    ]
    current_diff_paths = set(current["git"].get("diff_paths", []))
    expected_worktree_deleted = [
        path for path in missing if path not in expected_excluded and path in current_diff_paths
    ]
    expected_baseline_stale = [
        path
        for path in missing
        if path not in expected_excluded and path not in expected_worktree_deleted
    ]
    unexplained_missing = [
        path
        for path in missing
        if path not in expected_excluded
        and path not in expected_worktree_deleted
        and path not in expected_baseline_stale
    ]

    return {
        "schema_version": 1,
        "baseline_scope": "docs/auditorias/2026-09-14/evidencias/source-manifest.json: selected source/config/test files",
        "current_scope": current["seals"]["product"]["scope"],
        "scope_difference": {
            "classification": "EXPECTED",
            "reason": "o manifesto SA-001 inventaria e sela todo o produto fora dos prefixos canônicos de controle; o source-manifest histórico selecionava apenas 617 arquivos",
            "baseline_file_count": len(baseline),
            "current_product_file_count": len(current_product),
        },
        "current_candidate": current["candidate"],
        "summary": {
            "baseline_paths": len(baseline),
            "current_product_paths": len(current_product),
            "unchanged_paths": len(unchanged),
            "changed_hashes": len(changed),
            "worktree_attributed_changed_hashes": len(worktree_attributed_changed),
            "review_required_changed_hashes": len(changed),
            "expected_changed_hashes": 0,
            "unexplained_changed_hashes": len(unexplained_changed),
            "new_product_paths": len(new_paths),
            "review_required_new_worktree_paths": len(review_required_new_worktree),
            "expected_scope_expansion_paths": len(expected_scope_expansion),
            "unexplained_new_product_paths": len(unexplained_new),
            "missing_baseline_paths": len(missing),
            "expected_excluded_paths": len(expected_excluded),
            "expected_worktree_deleted_paths": len(expected_worktree_deleted),
            "expected_baseline_stale_paths": len(expected_baseline_stale),
            "unexplained_missing_paths": len(unexplained_missing),
        },
        "expected_differences": {
            "scope_expansion_paths": expected_scope_expansion,
            "excluded_baseline_paths": expected_excluded,
            "baseline_stale_paths": expected_baseline_stale,
        },
        "review_required_differences": {
            "changed_hashes": changed,
            "new_worktree_paths": review_required_new_worktree,
            "worktree_deleted_paths": expected_worktree_deleted,
        },
        "unexpected_differences": {
            "unexplained_changed_hashes": unexplained_changed,
            "unexplained_new_product_paths": unexplained_new,
            "unexplained_missing_paths": unexplained_missing,
        },
        "unchanged_paths": unchanged,
        "limitations": [
            "Presença no status do worktree apenas atribui a origem do drift; não aprova a mudança. Toda alteração de bytes continua em review_required_differences.",
            "Hash de arquivo sensível não publica seu conteúdo; nenhum valor de ambiente é copiado para este artefato.",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--current", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    baseline = json.loads(Path(args.baseline).read_text())
    current = json.loads(Path(args.current).read_text())
    result = compare(baseline, current)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=1, ensure_ascii=False) + "\n")
    print(
        json.dumps(
            {
                "out": str(out),
                "changed_hashes": result["summary"]["changed_hashes"],
                "unexpected": sum(
                    len(value) for value in result["unexpected_differences"].values()
                ),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
