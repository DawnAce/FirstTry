import asyncio
import io

from fastapi import HTTPException, UploadFile

from app.upload import read_upload


def _upload(content: bytes) -> UploadFile:
    return UploadFile(file=io.BytesIO(content), filename="test.xlsx")


def test_read_upload_accepts_file_within_limit():
    assert asyncio.run(read_upload(_upload(b"abc"), max_bytes=3)) == b"abc"


def test_read_upload_rejects_oversized_and_empty_files():
    for content, status in ((b"abcd", 413), (b"", 400)):
        try:
            asyncio.run(read_upload(_upload(content), max_bytes=3))
        except HTTPException as exc:
            assert exc.status_code == status
        else:
            raise AssertionError("上传边界应拒绝该文件")
