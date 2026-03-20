from datetime import date, datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.services.azdo.sync import AzdoSyncService
from app.models.sync_log import SyncLog
from app.models.work_item import WorkItem
from app.models.iteration import Iteration
from app.models.team_member import TeamMember

router = APIRouter()


# --- Schémas de réponse ---

class SyncResponse(BaseModel):
    status: str
    message: str
    items_synced: int = 0
    counts: dict = {}


class SyncLogResponse(BaseModel):
    id: int
    synced_at: datetime
    status: str
    details: str | None
    items_synced: int


class WorkItemResponse(BaseModel):
    id: int
    type: str
    title: str
    state: str | None
    iteration_path: str | None
    assigned_to: str | None
    story_points: float | None
    completed_work: float | None
    remaining_work: float | None
    parent_id: int | None
    synced_at: datetime | None

    class Config:
        from_attributes = True


class IterationResponse(BaseModel):
    id: int
    azdo_id: str | None
    name: str
    path: str | None
    start_date: date | None
    end_date: date | None

    class Config:
        from_attributes = True


class ConnectionTestResponse(BaseModel):
    ok: bool
    error: str | None
    details: str | None


# --- Endpoints ---

@router.post("/sync", response_model=SyncResponse)
async def trigger_sync(db: Session = Depends(get_db)):
    """Déclenche la synchronisation manuelle depuis Azure DevOps."""
    try:
        service = AzdoSyncService(db)
        result = await service.sync_all()
        return SyncResponse(
            status="success",
            message="Synchronisation terminée",
            items_synced=result["items_synced"],
            counts=result["counts"],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/test-connection", response_model=ConnectionTestResponse)
async def test_connection(db: Session = Depends(get_db)):
    """Teste la connexion AZDO sans écrire en base."""
    service = AzdoSyncService(db)
    return await service.test_connection()


@router.get("/sync/logs", response_model=list[SyncLogResponse])
def get_sync_logs(limit: int = 20, db: Session = Depends(get_db)):
    return db.query(SyncLog).order_by(SyncLog.synced_at.desc()).limit(limit).all()


@router.get("/work-items", response_model=list[WorkItemResponse])
def get_work_items(
    type: str | None = Query(None, description="Filtrer par type (séparés par virgule)"),
    state: str | None = Query(None, description="Filtrer par état (séparés par virgule)"),
    search: str | None = Query(None, description="Recherche dans le titre"),
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    q = db.query(WorkItem)
    if type:
        types = [t.strip() for t in type.split(",")]
        q = q.filter(WorkItem.type.in_(types))
    if state:
        states = [s.strip() for s in state.split(",")]
        q = q.filter(WorkItem.state.in_(states))
    if search:
        q = q.filter(WorkItem.title.ilike(f"%{search}%"))
    return q.order_by(WorkItem.id).offset(skip).limit(limit).all()


@router.get("/work-items/count")
def count_work_items(db: Session = Depends(get_db)):
    return {"count": db.query(WorkItem).count()}


@router.get("/iterations", response_model=list[IterationResponse])
def get_iterations(db: Session = Depends(get_db)):
    return db.query(Iteration).order_by(Iteration.start_date).all()
