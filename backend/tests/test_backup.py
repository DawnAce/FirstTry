import json
import zipfile

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
