"""Endpoints pour la consultation et la purge des logs LLM/AZDO."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime
from typing import Optional

from app.database import get_db
from app.models.llm_log import LLMLog

router = APIRouter()


# ── Schémas Pydantic ───────────────────────────────────────────────────────────

class LLMLogResponse(BaseModel):
    """Représentation d'une entrée de log retournée par l'API."""

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


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[LLMLogResponse])
def list_logs(
    log_type: Optional[str] = Query(None, description="Filtre par type de log (ex: LLM_REQUEST, AZDO_FETCH)"),
    work_item_id: Optional[int] = Query(None, description="Filtre par ID de work item AZDO"),
    session_id: Optional[int] = Query(None, description="Filtre par ID de session PBR"),
    limit: int = Query(100, le=500, description="Nombre maximum de résultats (max 500)"),
    db: Session = Depends(get_db),
):
    """Liste les logs LLM et AZDO avec filtres optionnels.

    Les résultats sont triés par date décroissante (plus récent en premier).
    """
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
    """Supprime tous les logs de la table llm_log.

    Retourne le nombre d'entrées supprimées.
    """
    count = db.query(LLMLog).count()
    db.query(LLMLog).delete()
    db.commit()
    return {"deleted": count}
