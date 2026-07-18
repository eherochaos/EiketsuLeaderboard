from __future__ import annotations

import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

import patch_battle_festival_period_source_runtime as module


OLD_MODELS = '''\
from sqlalchemy import String


class SharedContributionPackage(Base):
    festival_date_from: Mapped[str] = mapped_column(String(10), nullable=False, default="")
    festival_date_to: Mapped[str] = mapped_column(String(10), nullable=False, default="")
    schema_version: Mapped[str] = mapped_column(String(32), nullable=False)


class SharedContributionMatch(Base):
    pass


class ServerUpload(TimestampMixin, Base):
    festival_date_from: Mapped[str] = mapped_column(String(10), nullable=False, default="")
    festival_date_to: Mapped[str] = mapped_column(String(10), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="received", index=True)
'''

OLD_SHARE = '''\
def _update_package_row(
    package,
    manifest,
):
    package.festival_date_from = str(manifest.get("festival_date_from") or "")
    package.festival_date_to = str(manifest.get("festival_date_to") or "")
    package.schema_version = str(manifest.get("schema_version") or SHARE_SCHEMA_VERSION)
'''

OLD_SERVER_SHARE = '''\
def import_uploaded_package(manifest):
    upload = ServerUpload(
        festival_date_from=str(manifest.get("festival_date_from") or ""),
        festival_date_to=str(manifest.get("festival_date_to") or ""),
        status="completed",
    )
    return upload


def _upload_to_payload(upload):
    return {
        "festival_date_from": upload.festival_date_from,
        "festival_date_to": upload.festival_date_to,
        "status": upload.status,
    }


def _upload_result(upload):
    return UploadResult(status=upload.status)
'''


class PatchBattleFestivalPeriodSourceRuntimeTests(unittest.TestCase):
    def test_check_reports_changes_without_writing_or_backing_up(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            package_root = self._create_fake_package(Path(root))
            before = self._read_sources(package_root)

            result = module.check_runtime_patch(package_root)

            self.assertEqual(result["status"], "changes_required")
            self.assertEqual(result["mode"], "check")
            self.assertEqual(
                result["changedFiles"],
                [str(relative_path) for relative_path in module.REQUIRED_FILES],
            )
            self.assertEqual(len(result["pendingOperations"]), 5)
            self.assertEqual(result["backupFiles"], [])
            self.assertEqual(self._read_sources(package_root), before)
            self.assertEqual(self._backup_files(package_root), [])

    def test_apply_patches_all_passthroughs_and_creates_backups(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            package_root = self._create_fake_package(Path(root))
            before = self._read_sources(package_root)

            result = module.apply_runtime_patch(package_root)

            self.assertEqual(result["status"], "patched")
            self.assertEqual(len(result["changedFiles"]), 3)
            self.assertEqual(len(result["pendingOperations"]), 5)
            self.assertEqual(len(result["backupFiles"]), 3)
            models = (package_root / "db/models.py").read_text(encoding="utf-8")
            share = (package_root / "services/share.py").read_text(encoding="utf-8")
            server_share = (package_root / "services/server_share.py").read_text(
                encoding="utf-8"
            )
            self.assertEqual(models.count("festival_period_source:"), 2)
            self.assertIn(
                'package.festival_period_source = '
                'str(manifest.get("festival_period_source") or "")',
                share,
            )
            self.assertIn(
                'festival_period_source=str('
                'manifest.get("festival_period_source") or ""),',
                server_share,
            )
            self.assertIn(
                '"festival_period_source": upload.festival_period_source,',
                server_share,
            )
            for backup_path in map(Path, result["backupFiles"]):
                self.assertTrue(backup_path.is_file())
                relative = backup_path.relative_to(package_root)
                source_relative = Path(
                    str(relative).split(".bak-", maxsplit=1)[0]
                )
                self.assertEqual(
                    backup_path.read_text(encoding="utf-8"),
                    before[source_relative],
                )

    def test_second_apply_is_idempotent_and_creates_no_new_backups(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            package_root = self._create_fake_package(Path(root))
            module.apply_runtime_patch(package_root)
            backups_after_first_apply = self._backup_files(package_root)
            sources_after_first_apply = self._read_sources(package_root)

            result = module.apply_runtime_patch(package_root)

            self.assertEqual(result["status"], "already_patched")
            self.assertEqual(result["changedFiles"], [])
            self.assertEqual(result["pendingOperations"], [])
            self.assertEqual(result["backupFiles"], [])
            self.assertEqual(self._backup_files(package_root), backups_after_first_apply)
            self.assertEqual(self._read_sources(package_root), sources_after_first_apply)

    def test_anchor_failure_aborts_before_any_file_is_written(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            package_root = self._create_fake_package(Path(root))
            payload_path = package_root / "services/server_share.py"
            payload_path.write_text(
                OLD_SERVER_SHARE.replace(
                    '        "status": upload.status,\n',
                    '        "state": upload.status,\n',
                ),
                encoding="utf-8",
            )
            before = self._read_sources(package_root)

            with self.assertRaisesRegex(
                module.PatchError,
                "_upload_to_payload.festival_period_source 锚点不兼容",
            ):
                module.apply_runtime_patch(package_root)

            self.assertEqual(self._read_sources(package_root), before)
            self.assertEqual(self._backup_files(package_root), [])

    def test_cli_check_returns_three_when_changes_are_required(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            parent = Path(root)
            self._create_fake_package(parent)
            output = io.StringIO()

            with redirect_stdout(output):
                exit_code = module.main(
                    ["--check", "--package-root", str(parent)]
                )

            self.assertEqual(
                exit_code,
                module.CHECK_CHANGES_REQUIRED_EXIT_CODE,
            )
            result = json.loads(output.getvalue())
            self.assertEqual(result["status"], "changes_required")
            self.assertTrue(result["packageRoot"].endswith("eiketsu_env"))

    def test_cli_check_returns_zero_after_apply(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            parent = Path(root)
            package_root = self._create_fake_package(parent)
            module.apply_runtime_patch(package_root)
            output = io.StringIO()

            with redirect_stdout(output):
                exit_code = module.main(
                    ["--check", "--package-root", str(parent)]
                )

            self.assertEqual(exit_code, 0)
            result = json.loads(output.getvalue())
            self.assertEqual(result["status"], "already_patched")
            self.assertEqual(result["changedFiles"], [])

    def _create_fake_package(self, parent: Path) -> Path:
        package_root = parent / "eiketsu_env"
        (package_root / "db").mkdir(parents=True)
        (package_root / "services").mkdir()
        (package_root / "db/models.py").write_text(OLD_MODELS, encoding="utf-8")
        (package_root / "services/share.py").write_text(OLD_SHARE, encoding="utf-8")
        (package_root / "services/server_share.py").write_text(
            OLD_SERVER_SHARE,
            encoding="utf-8",
        )
        return package_root

    def _read_sources(self, package_root: Path) -> dict[Path, str]:
        return {
            relative_path: (package_root / relative_path).read_text(encoding="utf-8")
            for relative_path in module.REQUIRED_FILES
        }

    def _backup_files(self, package_root: Path) -> list[Path]:
        return sorted(package_root.rglob("*.bak-*"))


if __name__ == "__main__":
    unittest.main()
