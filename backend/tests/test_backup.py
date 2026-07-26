import json
import zipfile
from types import SimpleNamespace

from scripts import backup
from scripts.backup import _build_archive, verify_archive


def test_backup_archive_contains_database_uploads_and_verified_manifest(tmp_path):
    dump = tmp_path / "database.sql"
    dump.write_bytes(b"CREATE TABLE example (id INT);\n")
    uploads = tmp_path / "uploads"
    (uploads / "contracts").mkdir(parents=True)
    (uploads / "contracts" / "scan.pdf").write_bytes(b"pdf")
    archive = tmp_path / "backup.zip"

    manifest = _build_archive(dump, uploads, archive, "test_db")

    assert verify_archive(archive) == manifest
    with zipfile.ZipFile(archive) as zipped:
        assert zipped.read("database.sql") == dump.read_bytes()
        assert zipped.read("uploads/contracts/scan.pdf") == b"pdf"
        assert json.loads(zipped.read("manifest.json"))["upload_files"] == 1


def test_database_dump_does_not_require_reload_privilege(monkeypatch, tmp_path):
    monkeypatch.setattr(
        backup,
        "get_settings",
        lambda: SimpleNamespace(
            MYSQL_HOST="db",
            MYSQL_PORT=3306,
            MYSQL_USER="user",
            MYSQL_PASSWORD="password",
            MYSQL_DATABASE="database",
        ),
    )
    monkeypatch.setattr(backup.shutil, "which", lambda _: "mysqldump")
    captured = {}

    def run(command, **_kwargs):
        captured["command"] = command
        return SimpleNamespace(returncode=0, stderr=b"")

    monkeypatch.setattr(backup.subprocess, "run", run)

    backup._dump_database(tmp_path / "database.sql", "mysqldump")

    assert "--skip-lock-tables" in captured["command"]
    assert "--set-gtid-purged=OFF" in captured["command"]
