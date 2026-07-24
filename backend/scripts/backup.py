"""Back up the MySQL database and runtime uploads into one verified zip."""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from app.config import get_settings


BACKEND_DIR = Path(__file__).resolve().parents[1]
UPLOADS_DIR = BACKEND_DIR / "uploads"
DEFAULT_OUTPUT_DIR = BACKEND_DIR.parent / "backups"


def _sha256(stream) -> str:
    digest = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        digest.update(chunk)
    return digest.hexdigest()


def _dump_database(path: Path, mysqldump: str) -> None:
    settings = get_settings()
    executable = shutil.which(mysqldump)
    if executable is None:
        raise SystemExit(f"找不到 {mysqldump}，请安装 MySQL 客户端或用 --mysqldump 指定路径")
    command = [
        executable,
        f"--host={settings.MYSQL_HOST}",
        f"--port={settings.MYSQL_PORT}",
        f"--user={settings.MYSQL_USER}",
        "--single-transaction",
        "--quick",
        "--routines",
        "--events",
        "--triggers",
        "--default-character-set=utf8mb4",
        settings.MYSQL_DATABASE,
    ]
    env = os.environ.copy()
    env["MYSQL_PWD"] = settings.MYSQL_PASSWORD
    with path.open("wb") as output:
        result = subprocess.run(command, stdout=output, stderr=subprocess.PIPE, env=env)
    if result.returncode:
        raise SystemExit(f"mysqldump 失败：{result.stderr.decode(errors='replace').strip()}")


def _build_archive(dump_path: Path, uploads_dir: Path, archive_path: Path, database: str) -> dict:
    with dump_path.open("rb") as stream:
        dump_hash = _sha256(stream)
    upload_files = sorted(path for path in uploads_dir.rglob("*") if path.is_file()) if uploads_dir.exists() else []
    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "database": database,
        "database_sha256": dump_hash,
        "upload_files": len(upload_files),
    }
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
        archive.write(dump_path, "database.sql")
        for path in upload_files:
            archive.write(path, (Path("uploads") / path.relative_to(uploads_dir)).as_posix())
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    return manifest


def verify_archive(path: Path) -> dict:
    with zipfile.ZipFile(path) as archive:
        if archive.testzip() is not None:
            raise ValueError("归档 CRC 校验失败")
        names = set(archive.namelist())
        if not {"database.sql", "manifest.json"}.issubset(names):
            raise ValueError("归档缺少 database.sql 或 manifest.json")
        manifest = json.loads(archive.read("manifest.json"))
        with archive.open("database.sql") as stream:
            if _sha256(stream) != manifest["database_sha256"]:
                raise ValueError("数据库转储 SHA-256 校验失败")
        if sum(name.startswith("uploads/") and not name.endswith("/") for name in names) != manifest["upload_files"]:
            raise ValueError("uploads 文件数量与清单不一致")
    return manifest


def create_backup(output_dir: Path, keep: int, mysqldump: str) -> Path:
    if keep < 1:
        raise SystemExit("--keep 必须大于 0")
    settings = get_settings()
    output_dir.mkdir(parents=True, exist_ok=True)
    database = re.sub(r"[^0-9A-Za-z_-]", "_", settings.MYSQL_DATABASE)
    filename = f"{database}_{datetime.now():%Y%m%d_%H%M%S}.zip"
    destination = output_dir / filename

    with tempfile.TemporaryDirectory(dir=output_dir) as temp:
        temp_dir = Path(temp)
        dump_path = temp_dir / "database.sql"
        archive_path = temp_dir / filename
        _dump_database(dump_path, mysqldump)
        _build_archive(dump_path, UPLOADS_DIR, archive_path, settings.MYSQL_DATABASE)
        verify_archive(archive_path)
        shutil.move(archive_path, destination)

    archives = sorted(output_dir.glob(f"{database}_*.zip"), key=lambda path: path.stat().st_mtime, reverse=True)
    for old in archives[keep:]:
        old.unlink()
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description="备份 MySQL 与 backend/uploads")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--keep", type=int, default=14, help="保留最近 N 份（默认 14）")
    parser.add_argument("--mysqldump", default="mysqldump")
    parser.add_argument("--verify", type=Path, help="只校验已有归档")
    args = parser.parse_args()

    if args.verify:
        print(json.dumps(verify_archive(args.verify), ensure_ascii=False))
        return
    path = create_backup(args.output, args.keep, args.mysqldump)
    print(path)


if __name__ == "__main__":
    main()
