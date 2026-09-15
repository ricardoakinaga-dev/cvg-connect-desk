#!/usr/bin/env python3
"""Gera o manifesto verificável do candidato (SA-001/AC1).

O manifesto mantém dois selos relacionados, mas independentes:

* ``product_sha256`` cobre o produto, configuração, testes e operação;
* ``ledger_sha256`` cobre os documentos canônicos de controle e auditoria.

O conteúdo de arquivos sensíveis nunca é serializado. Quando um arquivo
sensível é versionado, seus bytes são usados somente para produzir um digest
local; o JSON publica apenas o digest, metadados e o caminho.

Uso:
  python3 scripts/programa-triplo-aaa/candidate_manifest.py [--repo DIR]
      [--out ARQUIVO] [--label LABEL]
"""
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import stat
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

REPO = Path(__file__).resolve().parents[2]

EXCLUDED_DIRS = {
    ".git",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".turbo",
    ".next",
    "playwright-report",
    "test-results",
    ".cache",
    ".vite",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "artifacts",
    ".gauntlet",
    ".gauntlet-v2-archive-20260912",
    ".opencode",
    ".agent",
    "before-snapshot",
}
SECRET_NAMES = {".env", ".env.local", ".env.production", ".env.development"}
PROGRAM_PREFIX = "docs/programa-triplo-aaa-2026-09-14/"
AUDIT_PREFIX = "docs/auditorias/"
CONTROL_PREFIXES = (PROGRAM_PREFIX, AUDIT_PREFIX)
INVENTORY_EXCLUDED_PREFIXES = (
    f"{PROGRAM_PREFIX}evidencias/",
    f"{AUDIT_PREFIX}**/evidencias/",
)
LEDGER_EXCLUDED_DIRS = {"evidencias", "evidence", "artifacts"}
LEDGER_EXCLUDED_NAMES = {
    "MANIFESTO.json",
    "EVIDENCE-INVENTORY.json",
    "ARTIFACTS.json",
    "source-manifest.json",
}
LEDGER_EXCLUDED_GLOBS = ("candidate-manifest*.json",)


class ManifestCollectionError(RuntimeError):
    """A coleta perdeu uma entrada; nunca emitir um manifesto parcial."""


def run(args: list[str], repo: Path = REPO) -> str:
    proc = subprocess.run(args, cwd=repo, capture_output=True, text=True, check=True)
    return proc.stdout.strip()


def run_bytes(args: list[str], repo: Path = REPO) -> bytes:
    proc = subprocess.run(args, cwd=repo, capture_output=True, check=True)
    return proc.stdout


def nul_paths(data: bytes) -> list[str]:
    return [item.decode("utf-8", errors="surrogateescape") for item in data.split(b"\0") if item]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git_status_codes(repo: Path) -> dict[str, str]:
    """Return porcelain status codes keyed by the current path.

    ``-z`` keeps paths unambiguous. For a rename/copy Git emits old and new
    paths; only the current path belongs in the inventory.
    """
    raw = run_bytes(
        ["git", "status", "--porcelain=v1", "--untracked-files=all", "-z"],
        repo,
    )
    tokens = raw.split(b"\0")
    statuses: dict[str, str] = {}
    index = 0
    while index < len(tokens) - 1:
        record = tokens[index]
        index += 1
        if not record:
            continue
        text = record.decode("utf-8", errors="surrogateescape")
        if len(text) < 4:
            continue
        code = text[:2]
        path = text[3:]
        if code[0] in {"R", "C"} and index < len(tokens):
            path = tokens[index].decode("utf-8", errors="surrogateescape")
            index += 1
        statuses[path] = code
    return statuses


def git_files(repo: Path) -> tuple[list[str], set[str], dict[str, str]]:
    tracked = set(nul_paths(run_bytes(["git", "ls-files", "-z"], repo)))
    untracked = set(
        nul_paths(run_bytes(["git", "ls-files", "--others", "--exclude-standard", "-z"], repo))
    )
    staged_deleted = set(
        nul_paths(
            run_bytes(
                ["git", "diff", "--cached", "--name-only", "--diff-filter=D", "-z"],
                repo,
            )
        )
    )
    # A staged deletion disappears from ``git ls-files`` even though it is
    # still part of the candidate's worktree diff. Keep it as a tracked
    # tombstone candidate so the seal cannot silently lose the removal.
    tracked |= staged_deleted
    return sorted(tracked | untracked), tracked, git_status_codes(repo)


def is_excluded(rel: str) -> bool:
    return any(part in EXCLUDED_DIRS for part in rel.split("/"))


def is_inventory_excluded(rel: str, excluded_paths: set[str]) -> bool:
    if is_excluded(rel) or rel in excluded_paths:
        return True
    if rel.startswith(f"{PROGRAM_PREFIX}evidencias/"):
        return True
    return rel.startswith(AUDIT_PREFIX) and "/evidencias/" in rel[len(AUDIT_PREFIX) :]


def secret_like(rel: str) -> bool:
    """Classify real dotenv files as sensitive, but not checked-in examples."""
    name = Path(rel).name
    return name in SECRET_NAMES or (
        name.startswith(".env.") and not name.endswith(".example")
    )


def describe(
    repo: Path,
    rel: str,
    tracked: set[str],
    status_codes: dict[str, str],
) -> dict:
    path = repo / rel
    if not path.is_file() and not path.is_symlink():
        status_code = status_codes.get(rel, "")
        if rel in tracked and "D" in status_code:
            return {
                "path": rel,
                "git_state": "tracked",
                "status_code": status_code,
                "mode": None,
                "size": 0,
                "kind": "deleted",
                "deleted": True,
            }
        raise ManifestCollectionError(f"entrada desapareceu ou não é arquivo/symlink: {rel}")
    try:
        file_stat = path.lstat()
    except OSError as error:
        raise ManifestCollectionError(f"não foi possível ler metadados de {rel}: {error}") from error
    if not (stat.S_ISREG(file_stat.st_mode) or stat.S_ISLNK(file_stat.st_mode)):
        raise ManifestCollectionError(f"tipo não suportado no inventário: {rel}")

    entry: dict = {
        "path": rel,
        "git_state": "tracked" if rel in tracked else "untracked",
        "mode": oct(stat.S_IMODE(file_stat.st_mode)),
        "size": file_stat.st_size,
        "kind": "symlink" if path.is_symlink() else "file",
    }
    if rel in status_codes:
        entry["status_code"] = status_codes[rel]

    if path.is_symlink():
        target = os.readlink(path)
        entry["symlink_target"] = target
        entry["symlink_target_sha256"] = hashlib.sha256(target.encode("utf-8")).hexdigest()
        return entry

    # The file is read only by the local hashing operation. Its bytes are
    # never copied into the manifest, logs, or terminal output.
    entry["sha256"] = sha256_file(path)
    if secret_like(rel):
        entry["secret"] = True
        entry["note"] = "bytes usados somente para digest local; conteúdo não publicado"
    return entry


def under_prefix(rel: str, prefix: str) -> bool:
    return rel.startswith(prefix)


def ledger_entry(rel: str) -> bool:
    if not any(under_prefix(rel, prefix) for prefix in CONTROL_PREFIXES):
        return False
    for prefix in CONTROL_PREFIXES:
        if not rel.startswith(prefix):
            continue
        relative = rel[len(prefix) :]
        parts = relative.split("/")
        if any(part in LEDGER_EXCLUDED_DIRS for part in parts[:-1]):
            return False
        name = parts[-1]
        if name in LEDGER_EXCLUDED_NAMES:
            return False
        if any(fnmatch.fnmatch(name, pattern) for pattern in LEDGER_EXCLUDED_GLOBS):
            return False
        return True
    return False


def seal_payload(entries: Iterable[dict]) -> list[dict]:
    return [
        {
            "path": entry["path"],
            "kind": entry.get("kind", "file"),
            "mode": entry.get("mode"),
            "sha256": entry.get("sha256"),
            "symlink_target_sha256": entry.get("symlink_target_sha256"),
        }
        for entry in sorted(entries, key=lambda item: item["path"])
    ]


def hash_entries(entries: Iterable[dict]) -> str:
    payload = json.dumps(
        seal_payload(entries), ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def summarize_entries(entries: list[dict], scope: str, **extra: object) -> dict:
    result = {
        "sha256": hash_entries(entries),
        "file_count": len(entries),
        "total_bytes": sum(entry.get("size") or 0 for entry in entries),
        "scope": scope,
    }
    result.update(extra)
    return result


def key_file_summary(inventory: list[dict]) -> dict[str, str | None]:
    key_files = [
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "turbo.json",
        "tsconfig.json",
        "vitest.config.ts",
        "playwright.config.ts",
        "eslint.config.js",
        "docker-compose.yml",
        "docker-compose.dev.yml",
        "docker-compose.staging.yml",
        "docker-compose.smoke.yml",
        ".env.example",
        ".env.production.example",
        "apps/desk-api/Dockerfile",
        "apps/desk-web/Dockerfile",
        "apps/message-worker/Dockerfile",
        "apps/realtime-service/Dockerfile",
        "services/db-init/Dockerfile",
        f"{PROGRAM_PREFIX}BACKLOG.json",
        f"{PROGRAM_PREFIX}REQUISITOS.json",
    ]
    return {
        rel: next((entry.get("sha256") for entry in inventory if entry["path"] == rel), None)
        for rel in key_files
    }


def build_manifest(
    repo: Path = REPO,
    label: str = "candidate",
    excluded_paths: Iterable[str] = (),
) -> dict:
    repo = repo.resolve()
    excluded_paths = set(excluded_paths)
    head = run(["git", "rev-parse", "HEAD"], repo)
    branch = run(["git", "branch", "--show-current"], repo)
    status_short = run(["git", "status", "--short", "--untracked-files=all"], repo)
    diff_stat = run(["git", "diff", "HEAD", "--stat"], repo)
    diff_names = nul_paths(run_bytes(["git", "diff", "HEAD", "--name-only", "-z"], repo))
    untracked_names = nul_paths(
        run_bytes(["git", "ls-files", "--others", "--exclude-standard", "-z"], repo)
    )

    files, tracked, status_codes = git_files(repo)
    files = [rel for rel in files if not is_inventory_excluded(rel, excluded_paths)]
    inventory: list[dict] = []
    for rel in files:
        entry = describe(repo, rel, tracked, status_codes)
        inventory.append(entry)

    product_entries = [
        entry
        for entry in inventory
        if not any(under_prefix(entry["path"], prefix) for prefix in CONTROL_PREFIXES)
    ]
    ledger_entries = [entry for entry in inventory if ledger_entry(entry["path"])]
    product_seal = summarize_entries(
        product_entries,
        "all inventory entries outside the canonical program and audit prefixes",
        excluded_prefixes=list(CONTROL_PREFIXES),
    )
    ledger_seal = summarize_entries(
        ledger_entries,
        "canonical control documents under the program and audit prefixes",
        prefixes=list(CONTROL_PREFIXES),
        excluded_dirs=sorted(LEDGER_EXCLUDED_DIRS),
        excluded_names=sorted(LEDGER_EXCLUDED_NAMES),
        excluded_globs=list(LEDGER_EXCLUDED_GLOBS),
        note="generated evidence/manifests stay outside this digest to avoid self-reference",
    )
    product_sha256 = product_seal["sha256"]
    ledger_sha256 = ledger_seal["sha256"]

    return {
        "manifest_version": 2,
        "label": label,
        "candidate": {
            "id": f"{head}+worktree#product-{product_sha256[:16]}",
            "revision": head,
            "product_sha256": product_sha256,
            "ledger_sha256": ledger_sha256,
            # Backward-compatible alias for consumers of the old helper.
            "tree_sha256": product_sha256,
            "identity_rule": "HEAD + worktree; product_sha256 identifica bytes/modos do produto e ledger_sha256 identifica separadamente o livro-caixa, ambos vinculados à mesma revisão",
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generator": "scripts/programa-triplo-aaa/candidate_manifest.py",
        "git": {
            "head": head,
            "branch": branch,
            "status_short": status_short,
            "status_entry_count": len(status_short.splitlines()) if status_short else 0,
            "modified_tracked_count": len(diff_names),
            "untracked_count": len(untracked_names),
            "diff_paths": diff_names,
            "diff_stat": diff_stat,
        },
        "counts": {
            "status_entries": len(status_short.splitlines()) if status_short else 0,
            "untracked_files": len(untracked_names),
            "modified_tracked": len(diff_names),
            "inventory_files": len(inventory),
            "definition_inventory_files": "arquivos após exclusão de diretórios gerados; cada entrada traz estado Git, modo e digest",
        },
        "seals": {
            "product": product_seal,
            "ledger": ledger_seal,
        },
        "inventory": {
            "file_count": len(inventory),
            "total_bytes": sum(entry.get("size") or 0 for entry in inventory),
            "excluded_dirs": sorted(EXCLUDED_DIRS),
            "excluded_prefixes": list(INVENTORY_EXCLUDED_PREFIXES),
            "excluded_paths": sorted(excluded_paths),
            "entries": inventory,
        },
        "key_files_sha256": key_file_summary(inventory),
    }


def write_manifest(manifest: dict, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default=str(REPO))
    parser.add_argument("--out", default=None)
    parser.add_argument("--label", default="candidate")
    args = parser.parse_args()

    repo = Path(args.repo).resolve()
    out = (
        Path(args.out).resolve()
        if args.out
        else repo / f"{PROGRAM_PREFIX}evidencias/SA-001/candidate-manifest-r3.json"
    )
    excluded_paths: set[str] = set()
    try:
        excluded_paths.add(out.relative_to(repo).as_posix())
    except ValueError:
        pass
    manifest = build_manifest(repo, args.label, excluded_paths)
    write_manifest(manifest, out)
    candidate = manifest["candidate"]
    print(
        json.dumps(
            {
                "out": str(out),
                "files": manifest["inventory"]["file_count"],
                "head": candidate["revision"],
                "product_sha256": candidate["product_sha256"],
                "ledger_sha256": candidate["ledger_sha256"],
                "modified": manifest["counts"]["modified_tracked"],
                "untracked": manifest["counts"]["untracked_files"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
