from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime
from typing import Optional

from app.database import get_db
from app.models.llm_log import LLMLog

router = APIRouter()


class LLMLogResponse(BaseModel):
    id: int
    created_at: datetime
    log_type: str
    work_item_id: Optional[int]
    session_id: Optional[int]
    summary: Optional[str]
    content: Optional[str]
    duration_ms: Optional[int]

    class Config:
        from_attributes = True


@router.get("/", response_model=list[LLMLogResponse])
def list_logs(
    log_type: Optional[str] = Query(None),
    work_item_id: Optional[int] = Query(None),
    session_id: Optional[int] = Query(None),
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
):
    q = db.query(LLMLog)
    if log_type:
        q = q.filter(LLMLog.log_type == log_type)
    if work_item_id:
        q = q.filter(LLMLog.work_item_id == work_item_id)
    if session_id:
        q = q.filter(LLMLog.session_id == session_id)
    return q.order_by(LLMLog.created_at.desc()).limit(limit).all()


@router.delete("/")
def clear_logs(db: Session = Depends(get_db)):
    count = db.query(LLMLog).count()
    db.query(LLMLog).delete()
    db.commit()
    return {"deleted": count}
