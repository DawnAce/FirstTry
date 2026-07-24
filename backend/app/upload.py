from fastapi import HTTPException, UploadFile


MAX_UPLOAD_BYTES = 20 * 1024 * 1024


async def read_upload(
    file: UploadFile,
    *,
    max_bytes: int = MAX_UPLOAD_BYTES,
    label: str = "上传文件",
) -> bytes:
    content = await file.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"{label}不能超过 {max_bytes // (1024 * 1024)} MB",
        )
    if not content:
        raise HTTPException(status_code=400, detail=f"{label}为空")
    return content
