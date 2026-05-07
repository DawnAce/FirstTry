from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models import ReportItemTemplate
from app.schemas.template import TemplateOut, TemplateCreate, TemplateUpdate

router = APIRouter(prefix="/api/templates", tags=["templates"])


@router.get("", response_model=List[TemplateOut])
def list_templates(db: Session = Depends(get_db)):
    """List all report item templates ordered by sort_order."""
    return (
        db.query(ReportItemTemplate)
        .order_by(ReportItemTemplate.sort_order, ReportItemTemplate.id)
        .all()
    )


@router.post("", response_model=TemplateOut, status_code=201)
def create_template(body: TemplateCreate, db: Session = Depends(get_db)):
    """Create a new report item template."""
    existing = (
        db.query(ReportItemTemplate)
        .filter(
            ReportItemTemplate.category == body.category,
            ReportItemTemplate.sub_category == body.sub_category,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Template with category='{body.category}' and sub_category='{body.sub_category}' already exists",
        )
    template = ReportItemTemplate(**body.model_dump())
    db.add(template)
    db.commit()
    db.refresh(template)
    return template


@router.put("/{template_id}", response_model=TemplateOut)
def update_template(template_id: int, body: TemplateUpdate, db: Session = Depends(get_db)):
    """Update an existing report item template."""
    template = db.query(ReportItemTemplate).filter(ReportItemTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    update_data = body.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(template, key, value)

    db.commit()
    db.refresh(template)
    return template


@router.delete("/{template_id}", status_code=204)
def delete_template(template_id: int, db: Session = Depends(get_db)):
    """Delete a report item template."""
    template = db.query(ReportItemTemplate).filter(ReportItemTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    db.delete(template)
    db.commit()
