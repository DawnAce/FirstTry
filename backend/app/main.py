from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import SessionLocal
from app.seeds.publication_schedule_2026 import seed_publication_schedule_2026
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
        count = seed_publication_schedule_2026(db)
        return {"message": f"Seeded {count} publication schedule entries"}
    finally:
        db.close()
