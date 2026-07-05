import os
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from datetime import date, timedelta

from app.database import SessionLocal, get_db, engine
from app.cache import get_dashboard_cache, set_dashboard_cache
from app.seeds.publication_schedule_2026 import seed_publication_schedule_2026
from app.seeds.report_templates import seed_report_templates
from app.seeds.products import seed_products
from app.seeds.bs_issues import seed_bs_issues
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
from app.api.orders import router as orders_router
from app.api.products import router as products_router
from app.api.order_import import router as order_import_router
from app.api.analytics import router as analytics_router
from app.api.customers import router as customers_router
from app.api.partners import router as partners_router
from app.api.contracts import router as contracts_router
from app.api.invoices import router as invoices_router
from app.api.settlements import router as settlements_router
from app.api.postal import router as postal_router
from app.api.search import router as search_router
from app.auth import get_current_user, require_admin
from app.models import Issue, PublicationSchedule, ReportEntry
from app.services.issue_service import build_issue_out

app = FastAPI(title="中国经营报 · 印数管理系统", version="1.0.0")


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
app.include_router(orders_router, dependencies=[Depends(get_current_user)])
app.include_router(products_router, dependencies=[Depends(get_current_user)])
app.include_router(order_import_router, dependencies=[Depends(get_current_user)])
app.include_router(analytics_router, dependencies=[Depends(get_current_user)])
app.include_router(customers_router, dependencies=[Depends(get_current_user)])
app.include_router(partners_router, dependencies=[Depends(get_current_user)])
app.include_router(contracts_router, dependencies=[Depends(get_current_user)])
app.include_router(invoices_router, dependencies=[Depends(get_current_user)])
app.include_router(settlements_router, dependencies=[Depends(get_current_user)])
app.include_router(postal_router, dependencies=[Depends(get_current_user)])
app.include_router(search_router, dependencies=[Depends(get_current_user)])


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

    # Excluded sub-categories for print total calculation
    excluded_subs = {
        '临时加印_自留', '营报传媒加印', '财经中心加印',
        '中经未来', '产经中心加印',
    }

    # Query 1: all issues (tiny table)
    all_issues = db.query(Issue).order_by(desc(Issue.issue_number)).all()
    recent_issues = all_issues[:10]
    total = len(recent_issues)
    draft = sum(1 for i in recent_issues if i.status.value == "draft")
    existing_numbers = {i.issue_number for i in all_issues}

    # Compute print totals for recent issues
    issue_print_totals: dict[int, int] = {}
    if recent_issues:
        recent_ids = [i.id for i in recent_issues]
        entries = (
            db.query(ReportEntry.issue_id, ReportEntry.sub_category, ReportEntry.value)
            .filter(ReportEntry.issue_id.in_(recent_ids))
            .all()
        )
        for issue_id, sub_cat, value in entries:
            if sub_cat not in excluded_subs:
                issue_print_totals[issue_id] = issue_print_totals.get(issue_id, 0) + (value or 0)

    # This-week vs last-week print totals
    # "This week" = issues with publish_date in current week (Mon-Sun)
    week_start = today - timedelta(days=today.weekday())
    last_week_start = week_start - timedelta(days=7)

    this_week_issues = [i for i in all_issues if week_start <= i.publish_date <= today]
    last_week_issues = [i for i in all_issues if last_week_start <= i.publish_date < week_start]

    this_week_total = sum(issue_print_totals.get(i.id, 0) for i in this_week_issues)
    last_week_total = sum(issue_print_totals.get(i.id, 0) for i in last_week_issues)

    # For issues not in recent_issues, query their totals separately
    extra_ids = set()
    for i in this_week_issues + last_week_issues:
        if i.id not in issue_print_totals:
            extra_ids.add(i.id)
    if extra_ids:
        extra_entries = (
            db.query(ReportEntry.issue_id, ReportEntry.sub_category, ReportEntry.value)
            .filter(ReportEntry.issue_id.in_(list(extra_ids)))
            .all()
        )
        extra_totals: dict[int, int] = {}
        for issue_id, sub_cat, value in extra_entries:
            if sub_cat not in excluded_subs:
                extra_totals[issue_id] = extra_totals.get(issue_id, 0) + (value or 0)
        this_week_total = sum(extra_totals.get(i.id, issue_print_totals.get(i.id, 0)) for i in this_week_issues)
        last_week_total = sum(extra_totals.get(i.id, issue_print_totals.get(i.id, 0)) for i in last_week_issues)

    # Latest report time (most recent created_at)
    latest_issue = all_issues[0] if all_issues else None
    latest_report_time = latest_issue.created_at.isoformat() if latest_issue and latest_issue.created_at else None

    # Next issue info from schedule
    next_issue_number = None
    next_issue_publish_date = None
    for e in db.query(PublicationSchedule).filter(
        PublicationSchedule.is_suspended == False
    ).order_by(PublicationSchedule.publish_date.asc()).all():
        if e.issue_number not in existing_numbers and e.publish_date >= today:
            next_issue_number = e.issue_number
            next_issue_publish_date = e.publish_date
            break

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
                "print_total": issue_print_totals.get(issue_out.id, 0),
            }
            for issue_out in (build_issue_out(db, i) for i in recent_issues)
        ],
        "stats": {"total": total, "draft": draft},
        "weekly_stats": {
            "this_week_total": this_week_total,
            "last_week_total": last_week_total,
            "week_change": this_week_total - last_week_total,
        },
        "latest_report_time": latest_report_time,
        "next_issue_number": next_issue_number,
        "next_issue_publish_date": next_issue_publish_date.isoformat() if next_issue_publish_date else None,
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
        product_count = seed_products(db)
        bs_issue_count = seed_bs_issues(db)
        return {
            "message": (
                f"Seeded {schedule_count} schedule entries, "
                f"{template_count} report templates, {product_count} products, "
                f"{bs_issue_count} 商学院刊期"
            )
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
