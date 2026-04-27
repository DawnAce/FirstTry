import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from app.database import SessionLocal
from app.seeds.publication_schedule_2026 import seed_publication_schedule_2026
from app.seeds.report_templates import seed_report_templates
from app.api.schedule import router as schedule_router
from app.api.issues import router as issues_router
from app.api.reports import router as reports_router
from app.api.recipients import router as recipients_router
from app.api.shipping import router as shipping_router
from app.api.exports import router as exports_router

app = FastAPI(title="中国经营报 · 印数报数系统", version="1.0.0")

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
