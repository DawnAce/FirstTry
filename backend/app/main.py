import os
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import desc
from datetime import date

from app.database import SessionLocal, get_db, engine
from app.cache import get_dashboard_cache, set_dashboard_cache
from app.seeds.publication_schedule_2026 import seed_publication_schedule_2026
from app.seeds.report_templates import seed_report_templates
from app.api.schedule import router as schedule_router
from app.api.issues import router as issues_router
from app.api.reports import router as reports_router
from app.api.recipients import router as recipients_router
from app.api.shipping import router as shipping_router
from app.api.exports import router as exports_router
from app.api.templates import router as templates_router
from app.api.auth import router as auth_router
from app.api.shipping_details import router as shipping_details_router
from app.api.operation_logs import router as operation_logs_router
from app.api.history_import import router as history_import_router
from app.auth import get_current_user, require_admin
from app.models import Issue, PublicationSchedule
from app.services.issue_service import build_issue_out

app = FastAPI(title="中国经营报 · 印数报数系统", version="1.0.0")


@app.on_event("startup")
def warmup_pool():
    """Pre-create DB connections and warm dashboard cache."""
    from sqlalchemy import text
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(schedule_router, dependencies=[Depends(get_current_user)])
app.include_router(issues_router, dependencies=[Depends(get_current_user)])
app.include_router(reports_router, dependencies=[Depends(get_current_user)])
app.include_router(recipients_router, dependencies=[Depends(get_current_user)])
app.include_router(shipping_router, dependencies=[Depends(get_current_user)])
app.include_router(exports_router, dependencies=[Depends(get_current_user)])
app.include_router(templates_router, dependencies=[Depends(get_current_user)])
app.include_router(auth_router)
app.include_router(shipping_details_router, dependencies=[Depends(get_current_user)])
app.include_router(operation_logs_router, dependencies=[Depends(get_current_user)])
app.include_router(history_import_router, dependencies=[Depends(get_current_user)])


@app.get("/api/health")
def health_check():
    return {"status": "ok"}


@app.get("/api/dashboard")
def dashboard_data(db: Session = Depends(get_db), _user = Depends(get_current_user)):
    """Combined endpoint for Dashboard — cached with 30s TTL."""
    cached = get_dashboard_cache()
    if cached is not None:
        return cached

    today = date.today()

    # Query 1: all issues (tiny table)
    all_issues = db.query(Issue).order_by(desc(Issue.issue_number)).all()
    recent_issues = all_issues[:10]
    total = len(recent_issues)
    draft = sum(1 for i in recent_issues if i.status.value == "draft")
    existing_numbers = {i.issue_number for i in all_issues}

    # Query 2: all non-suspended schedule entries
    schedule_entries = (
        db.query(PublicationSchedule)
        .filter(PublicationSchedule.is_suspended == False)
        .order_by(PublicationSchedule.publish_date.asc())
        .all()
    )

    # Compute available issues (not yet created) in Python
    available = [
        {"issue_number": e.issue_number, "publish_date": e.publish_date}
        for e in schedule_entries
        if e.issue_number not in existing_numbers
    ]

    # Compute next issue info (first available with publish_date >= today)
    next_info = None
    for e in schedule_entries:
        if e.issue_number not in existing_numbers and e.publish_date >= today:
            next_info = {
                "issue_number": e.issue_number,
                "publish_date": e.publish_date,
                "previous_issue_id": all_issues[0].id if all_issues else None,
            }
            break

    result = {
        "recent_issues": [
            {
                "id": issue_out.id,
                "issue_number": issue_out.issue_number,
                "year_issue_index": issue_out.year_issue_index,
                "year_issue_label": issue_out.year_issue_label,
                "publish_date": issue_out.publish_date.isoformat(),
                "page_count": issue_out.page_count,
                "status": issue_out.status.value,
                "notes": issue_out.notes,
                "created_at": issue_out.created_at.isoformat() if issue_out.created_at else None,
                "updated_at": issue_out.updated_at.isoformat() if issue_out.updated_at else None,
            }
            for issue_out in (build_issue_out(db, i) for i in recent_issues)
        ],
        "stats": {"total": total, "draft": draft},
        "next_issue": next_info,
        "available_issues": available,
    }

    set_dashboard_cache(result)
    return result


@app.post("/api/admin/seed")
def run_seeds(_user = Depends(require_admin)):
    db = SessionLocal()
    try:
        schedule_count = seed_publication_schedule_2026(db)
        template_count = seed_report_templates(db)
        return {
            "message": f"Seeded {schedule_count} schedule entries, {template_count} report templates"
        }
    finally:
        db.close()


# Serve frontend static files in production
# In development, Vite dev server handles frontend (port 5173)
frontend_dist = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
if os.path.exists(frontend_dist) and os.environ.get("ENV", "production") != "development":
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dist, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Catch-all route to serve React SPA for client-side routing."""
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API route not found")
        file_path = os.path.join(frontend_dist, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(frontend_dist, "index.html"))
