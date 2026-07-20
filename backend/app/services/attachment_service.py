"""通用附件落盘（合同扫描件 / 发票 / 结算单等）。

把刊期表上传的落盘思路(``publication_schedule_upload_service.store_uploaded_pdf``)泛化为按
``category`` 存到 ``backend/uploads/<category>/``。``store_file`` 返回相对 ``backend/`` 的路径，
存进各业务表的 ``*_path`` 字段；下载经**鉴权接口**流式返回，不做静态暴露（合同等属敏感件）。
``resolve_path`` 解析回绝对路径并防目录穿越。
"""

import re
from contextlib import suppress
from hashlib import sha256
from pathlib import Path
from uuid import uuid4

UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads"
MAX_FILENAME_BYTES = 255


def sha256_hex(content: bytes) -> str:
    """内容 SHA-256 十六进制摘要（来源文件 / 生成产物追溯用）。"""
    return sha256(content).hexdigest()


def _truncate_utf8(value: str, max_bytes: int) -> str:
    result: list[str] = []
    used_bytes = 0
    for character in value:
        character_bytes = len(character.encode("utf-8"))
        if used_bytes + character_bytes > max_bytes:
            break
        result.append(character)
        used_bytes += character_bytes
    return "".join(result)


def _safe_filename(filename: str) -> str:
    """生成安全的落盘文件名：清洗 stem + uuid 去重，保留原扩展名。"""
    path = Path(filename)
    suffix = path.suffix.lower() or ".bin"
    unique_token = uuid4().hex
    stem = re.sub(r"[^0-9A-Za-z一-鿿._-]", "_", path.stem)
    stem = stem.strip("._") or "file"
    suffix_bytes = len(suffix.encode("utf-8"))
    max_stem_bytes = max(
        0, MAX_FILENAME_BYTES - len("_") - len(unique_token) - suffix_bytes
    )
    stem = _truncate_utf8(stem, max_stem_bytes)
    return f"{stem}_{unique_token}{suffix}"


def store_file(category: str, filename: str, content: bytes) -> str:
    """把 ``content`` 存到 ``backend/uploads/<category>/``，返回相对 backend/ 的 posix 路径。"""
    safe_category = re.sub(r"[^0-9A-Za-z_-]", "_", category) or "misc"
    cat_dir = UPLOAD_ROOT / safe_category
    cat_dir.mkdir(parents=True, exist_ok=True)
    stored_file = cat_dir / _safe_filename(filename)
    stored_file.write_bytes(content)
    return stored_file.relative_to(UPLOAD_ROOT.parent).as_posix()


def resolve_path(stored_path: str) -> Path:
    """把存的相对路径解析回绝对路径，并防目录穿越（必须落在 uploads 内）。"""
    base = UPLOAD_ROOT.parent.resolve()
    target = (base / stored_path).resolve()
    uploads_root = UPLOAD_ROOT.resolve()
    if target != uploads_root and uploads_root not in target.parents:
        raise ValueError("非法的附件路径")
    return target


def delete_file(stored_path: str | None) -> None:
    """尽力删除落盘文件（路径非法 / 文件不存在均静默跳过）。"""
    if not stored_path:
        return
    with suppress(Exception):
        target = resolve_path(stored_path)
        if target.exists():
            target.unlink()
