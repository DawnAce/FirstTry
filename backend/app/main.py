import os
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import desc
from app.database import SessionLocal, get_db, engine
from app.seeds.publication_schedule_2026 import seed_publication_schedule_2026
from app.seeds.report_templates import seed_report_templates
from app.api.schedule import router as schedule_router
from app.api.issues import router as issues_router
from app.api.reports import router as reports_router
from app.api.recipients import router as recipients_router
from app.api.shipping import router as shipping_router
from app.api.exports import router as exports_router
from app.models import Issue
from app.services.issue_service import get_next_issue_info, get_available_issues

app = FastAPI(title="中国经营报 · 印数报数系统", version="1.0.0")


@app.on_event("startup")
def warmup_pool():
    """Pre-create DB connections to avoid cold-start latency."""
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

app.include_router(schedule_router)
app.include_router(issues_router)
app.include_router(reports_router)
app.include_router(recipients_router)
app.include_router(shipping_router)
app.include_router(exports_router)


@app.get("/api/health")
def health_check():
    return {"status": "ok"}


@app.get("/api/dashboard")
def dashboard_data(db: Session = Depends(get_db)):
    """Combined endpoint for Dashboard — single DB session, one round-trip."""
    issues = db.query(Issue).order_by(desc(Issue.issue_number)).limit(10).all()
    total = len(issues)
    draft = sum(1 for i in issues if i.status.value == "draft")
    next_info = get_next_issue_info(db)
    available = get_available_issues(db)

    return {
        "recent_issues": [
            {
                "id": i.id,
                "issue_number": i.issue_number,
                "publish_date": i.publish_date.isoformat(),
                "status": i.status.value,
                "notes": i.notes,
                "created_at": i.created_at.isoformat() if i.created_at else None,
                "updated_at": i.updated_at.isoformat() if i.updated_at else None,
            }
            for i in issues
        ],
        "stats": {"total": total, "draft": draft},
        "next_issue": next_info,
        "available_issues": available,
    }


@app.post("/api/admin/seed")
def run_seeds():
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
frontend_dist = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
if os.path.exists(frontend_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dist, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Catch-all route to serve React SPA for client-side routing."""
        file_path = os.path.join(frontend_dist, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(frontend_dist, "index.html"))
