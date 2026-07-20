"""邮局订报数据生成模块 REST API（挂 ``/api/subscription``）。

读对所有登录用户开放；写（建批次 / 上传导入 / 设为有效 / 生成）要求 ``require_admin``。
接口能力边界照文档 §11。关键动作写 operation_log。
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import (
    SubscriptionGenerationRun,
    SubscriptionOutputArtifact,
    User,
)
from app.schemas.subscription import (
    ArtifactOut,
    BatchCreateIn,
    BatchDetailOut,
    BatchOut,
    GenerationRunOut,
    ImportStatusOut,
    ImportVersionOut,
    ValidationIssueOut,
)
from app.services import attachment_service
from app.services import subscription_generation_service as gen_svc
from app.services import subscription_import_service as import_svc
from app.services import subscription_service as batch_svc
from app.services.operation_log_service import record_operation

router = APIRouter(prefix="/api/subscription", tags=["subscription"])


def _log(db: Session, *, table: str, record_id: int, action: str, user: User, name: Optional[str] = None):
    record_operation(db, table_name=table, record_id=record_id, action=action, user=user, record_name=name)
    db.commit()


# --- 批次 --------------------------------------------------------------------

@router.post("/batches", response_model=BatchOut, status_code=201)
def create_batch(body: BatchCreateIn, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    batch = batch_svc.create_batch(db, body.model_dump(), operator_id=getattr(user, "id", None))
    _log(db, table="subscription_batches", record_id=batch.id, action="create", user=user,
         name=f"{batch.year}年{batch.start_month}月订报批次")
    return batch


@router.get("/batches", response_model=List[BatchOut])
def list_batches(db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    return batch_svc.list_batches(db)


@router.get("/batches/{batch_id}", response_model=BatchDetailOut)
def get_batch(batch_id: int, db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    return batch_svc.get_batch(db, batch_id)


# --- 导入版本 ----------------------------------------------------------------

@router.post("/batches/{batch_id}/imports", response_model=ImportVersionOut)
async def create_import(
    batch_id: int,
    file_a: UploadFile = File(..., description="来源A 订阅明细"),
    file_b: Optional[UploadFile] = File(None, description="来源B 读者统计"),
    reason: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    batch = batch_svc.get_batch(db, batch_id)
    files = [("A", file_a.filename, await file_a.read())]
    if file_b is not None:
        files.append(("B", file_b.filename, await file_b.read()))
    version = import_svc.create_version(db, batch, files, reason=reason, operator_id=getattr(user, "id", None))
    _log(db, table="subscription_import_versions", record_id=version.id, action="create", user=user,
         name=f"批次{batch_id} V{version.version_no}")
    return version


@router.get("/imports/{version_id}", response_model=ImportStatusOut)
def get_import(version_id: int, db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    version = batch_svc.get_version(db, version_id)
    counts = batch_svc.issue_counts(version)
    return ImportStatusOut(
        version=version, issue_counts=counts,
        can_activate=(counts["block"] == 0 and version.status.value in ("validation_passed", "active")),
    )


@router.get("/imports/{version_id}/issues", response_model=List[ValidationIssueOut])
def get_import_issues(version_id: int, db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    version = batch_svc.get_version(db, version_id)
    return sorted(version.issues, key=lambda i: (i.level.value, i.row_no or 0))


@router.post("/imports/{version_id}/activate", response_model=ImportVersionOut)
def activate_import(version_id: int, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    version = batch_svc.activate_version(db, version_id)
    _log(db, table="subscription_import_versions", record_id=version.id, action="update", user=user,
         name=f"设为有效 V{version.version_no}")
    return version


# --- 生成 --------------------------------------------------------------------

@router.post("/batches/{batch_id}/generate", response_model=GenerationRunOut)
def generate(batch_id: int, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    batch = batch_svc.get_batch(db, batch_id)
    run = gen_svc.generate(db, batch, operator_id=getattr(user, "id", None))
    _log(db, table="subscription_generation_runs", record_id=run.id, action="create", user=user,
         name=f"批次{batch_id} 生成")
    return run


@router.get("/generation-runs/{run_id}", response_model=GenerationRunOut)
def get_run(run_id: int, db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    run = db.query(SubscriptionGenerationRun).filter(SubscriptionGenerationRun.id == run_id).first()
    if run is None:
        raise HTTPException(status_code=404, detail=f"生成任务 {run_id} 不存在")
    return run


@router.get("/batches/{batch_id}/artifacts", response_model=List[ArtifactOut])
def list_artifacts(batch_id: int, db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    return (
        db.query(SubscriptionOutputArtifact)
        .filter(SubscriptionOutputArtifact.batch_id == batch_id)
        .order_by(SubscriptionOutputArtifact.is_historical, SubscriptionOutputArtifact.id.desc())
        .all()
    )


@router.get("/artifacts/{artifact_id}/download")
def download_artifact(artifact_id: int, db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    art = db.query(SubscriptionOutputArtifact).filter(SubscriptionOutputArtifact.id == artifact_id).first()
    if art is None:
        raise HTTPException(status_code=404, detail="产物不存在")
    try:
        path = attachment_service.resolve_path(art.stored_path)
    except ValueError:
        raise HTTPException(status_code=400, detail="非法的产物路径")
    if not path.exists():
        raise HTTPException(status_code=404, detail="产物文件已丢失")
    return FileResponse(path, filename=art.filename)
