#!/usr/bin/env python3
"""Controles known-good/known-bad do manifesto de candidato (SA-001)."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import candidate_manifest  # noqa: E402


PROGRAM = Path(candidate_manifest.PROGRAM_PREFIX)


def git(repo: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True)


def entry(manifest: dict, path: str) -> dict:
    return next(item for item in manifest["inventory"]["entries"] if item["path"] == path)


class CandidateManifestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory(prefix="sa001-manifest-")
        self.repo = Path(self.tempdir.name)
        git(self.repo, "init", "--quiet")
        git(self.repo, "config", "user.email", "sa001@example.invalid")
        git(self.repo, "config", "user.name", "SA-001 test")

        files = {
            ".env.production.example": "SECRET_KEY=value-one\n",
            ".env.production": "TOP_SECRET=never-publish-this-value\n",
            "package.json": '{"name":"fixture"}\n',
            "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
            "src/app.ts": "export const app = true;\n",
            "src/other.ts": "export const other = true;\n",
            "docs/auditorias/report.md": "baseline audit\n",
            str(PROGRAM / "README.md"): "baseline program\n",
            str(PROGRAM / "evidencias" / "old.json"): '{"old":true}\n',
        }
        for relative, content in files.items():
            path = self.repo / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        os.symlink("app.ts", self.repo / "src/current.ts")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "--quiet", "-m", "fixture")

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def test_known_good_is_stable_and_separates_product_from_ledger(self) -> None:
        baseline = candidate_manifest.build_manifest(self.repo, "test")
        repeated = candidate_manifest.build_manifest(self.repo, "test")

        self.assertEqual(
            baseline["candidate"]["product_sha256"], repeated["candidate"]["product_sha256"]
        )
        self.assertEqual(
            baseline["candidate"]["ledger_sha256"], repeated["candidate"]["ledger_sha256"]
        )
        self.assertNotEqual(
            baseline["candidate"]["product_sha256"], baseline["candidate"]["ledger_sha256"]
        )
        example_entry = entry(baseline, ".env.production.example")
        self.assertNotIn("secret", example_entry)
        self.assertIsNotNone(example_entry["sha256"])
        self.assertTrue(entry(baseline, ".env.production")["secret"])
        self.assertIsNotNone(entry(baseline, ".env.production")["sha256"])
        serialized = json.dumps(baseline, ensure_ascii=False)
        self.assertNotIn("never-publish-this-value", serialized)
        self.assertNotIn("TOP_SECRET=", serialized)
        ledger_paths = {
            item["path"]
            for item in baseline["inventory"]["entries"]
            if candidate_manifest.ledger_entry(item["path"])
        }
        self.assertNotIn(
            "docs/programa-triplo-aaa-2026-09-14/evidencias/old.json", ledger_paths
        )
        product_paths = {
            item["path"]
            for item in baseline["inventory"]["entries"]
            if not any(
                item["path"].startswith(prefix)
                for prefix in candidate_manifest.CONTROL_PREFIXES
            )
        }
        self.assertEqual(baseline["seals"]["product"]["file_count"], len(product_paths))

    def test_same_size_versioned_env_mutation_changes_product_seal(self) -> None:
        baseline = candidate_manifest.build_manifest(self.repo, "test")
        env_example = self.repo / ".env.production.example"
        env_example.write_text("SECRET_KEY=value-two\n")
        changed = candidate_manifest.build_manifest(self.repo, "test")
        self.assertEqual(env_example.stat().st_size, 21)
        self.assertNotEqual(
            baseline["candidate"]["product_sha256"], changed["candidate"]["product_sha256"]
        )

    def test_audit_and_program_mutations_change_only_ledger(self) -> None:
        baseline = candidate_manifest.build_manifest(self.repo, "test")

        audit = self.repo / "docs/auditorias/report.md"
        audit.write_text("changed audit\n")
        audit_changed = candidate_manifest.build_manifest(self.repo, "test")
        self.assertEqual(
            baseline["candidate"]["product_sha256"], audit_changed["candidate"]["product_sha256"]
        )
        self.assertNotEqual(
            baseline["candidate"]["ledger_sha256"], audit_changed["candidate"]["ledger_sha256"]
        )
        audit.write_text("baseline audit\n")

        program = self.repo / PROGRAM / "README.md"
        program.write_text("changed program\n")
        program_changed = candidate_manifest.build_manifest(self.repo, "test")
        self.assertEqual(
            baseline["candidate"]["product_sha256"], program_changed["candidate"]["product_sha256"]
        )
        self.assertNotEqual(
            baseline["candidate"]["ledger_sha256"], program_changed["candidate"]["ledger_sha256"]
        )

    def test_mode_symlink_and_add_remove_mutations_change_product_seal(self) -> None:
        baseline = candidate_manifest.build_manifest(self.repo, "test")

        source = self.repo / "src/app.ts"
        original_mode = source.stat().st_mode & 0o777
        source.chmod(0o755)
        mode_changed = candidate_manifest.build_manifest(self.repo, "test")
        self.assertNotEqual(
            baseline["candidate"]["product_sha256"], mode_changed["candidate"]["product_sha256"]
        )
        source.chmod(original_mode)

        link = self.repo / "src/current.ts"
        link.unlink()
        os.symlink("other.ts", link)
        symlink_changed = candidate_manifest.build_manifest(self.repo, "test")
        self.assertNotEqual(
            baseline["candidate"]["product_sha256"], symlink_changed["candidate"]["product_sha256"]
        )
        self.assertEqual(entry(symlink_changed, "src/current.ts")["kind"], "symlink")
        link.unlink()
        os.symlink("app.ts", link)

        added = self.repo / "src/added.ts"
        added.write_text("export const added = true;\n")
        added_manifest = candidate_manifest.build_manifest(self.repo, "test")
        self.assertNotEqual(
            baseline["candidate"]["product_sha256"], added_manifest["candidate"]["product_sha256"]
        )
        added.unlink()
        removed_manifest = candidate_manifest.build_manifest(self.repo, "test")
        self.assertEqual(
            baseline["candidate"]["product_sha256"], removed_manifest["candidate"]["product_sha256"]
        )

    def test_staged_addition_is_visible_in_diff_and_inventory(self) -> None:
        baseline = candidate_manifest.build_manifest(self.repo, "test")
        staged = self.repo / "src/staged.ts"
        staged.write_text("export const staged = true;\n")
        git(self.repo, "add", "src/staged.ts")
        changed = candidate_manifest.build_manifest(self.repo, "test")

        staged_entry = entry(changed, "src/staged.ts")
        self.assertEqual(staged_entry["status_code"], "A ")
        self.assertIn("src/staged.ts", changed["git"]["diff_paths"])
        self.assertNotEqual(
            baseline["candidate"]["product_sha256"], changed["candidate"]["product_sha256"]
        )

    def test_unstaged_change_and_tracked_removal_are_visible(self) -> None:
        baseline = candidate_manifest.build_manifest(self.repo, "test")

        source = self.repo / "src/app.ts"
        source.write_text("export const app = false;\n")
        unstaged = candidate_manifest.build_manifest(self.repo, "test")
        self.assertEqual(entry(unstaged, "src/app.ts")["status_code"], " M")
        self.assertIn("src/app.ts", unstaged["git"]["diff_paths"])
        self.assertNotEqual(
            baseline["candidate"]["product_sha256"], unstaged["candidate"]["product_sha256"]
        )

        removed = self.repo / "src/other.ts"
        removed.unlink()
        deleted = candidate_manifest.build_manifest(self.repo, "test")
        self.assertEqual(entry(deleted, "src/other.ts")["kind"], "deleted")
        self.assertIn("src/other.ts", deleted["git"]["diff_paths"])
        self.assertNotEqual(
            baseline["candidate"]["product_sha256"], deleted["candidate"]["product_sha256"]
        )

        git(self.repo, "add", "-u", "--", "src/other.ts")
        staged_deleted = candidate_manifest.build_manifest(self.repo, "test")
        self.assertEqual(entry(staged_deleted, "src/other.ts")["kind"], "deleted")
        self.assertEqual(entry(staged_deleted, "src/other.ts")["status_code"], "D ")
        self.assertIn("src/other.ts", staged_deleted["git"]["diff_paths"])
        self.assertNotEqual(
            baseline["candidate"]["product_sha256"],
            staged_deleted["candidate"]["product_sha256"],
        )

    def test_git_failure_is_closed(self) -> None:
        with self.assertRaises(subprocess.CalledProcessError):
            candidate_manifest.run(
                ["git", "cat-file", "-e", "does-not-exist^{commit}"], self.repo
            )

    def test_inventory_collection_is_closed_on_missing_entry(self) -> None:
        with self.assertRaises(candidate_manifest.ManifestCollectionError):
            candidate_manifest.describe(self.repo, "src/does-not-exist.ts", set(), {})


if __name__ == "__main__":
    unittest.main()
