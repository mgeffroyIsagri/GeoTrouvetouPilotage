"""Endpoints CRUD pour la gestion des congés et absences."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models.leave import Leave

router = APIRouter()


# ── Schémas Pydantic ───────────────────────────────────────────────────────────

class LeaveCreate(BaseModel):
    """Corps de création d'un congé."""

    pi_id: int
    team_member_id: int
    sprint_number: int
    day_offset: float
    duration_days: float = 1.0
    label: str | None = None


class LeaveUpdate(BaseModel):
    """Corps de mise à jour partielle d'un congé (champs optionnels)."""

    day_offset: float | None = None
    duration_days: float | None = None
    label: str | None = None


class LeaveResponse(BaseModel):
    """Représentation d'un congé retourné par l'API."""

    id: int
    pi_id: int
    team_member_id: int
    sprint_number: int
    day_offset: float
    duration_days: float
    label: str | None

    class Config:
        from_attributes = True


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/pi/{pi_id}", response_model=list[LeaveResponse])
def get_leaves(pi_id: int, db: Session = Depends(get_db)):
    """Retourne tous les congés d'un PI, tous sprints confondus."""
    return db.query(Leave).filter(Leave.pi_id == pi_id).all()


@router.get("/pi/{pi_id}/sprint/{sprint_number}", response_model=list[LeaveResponse])
def get_leaves_for_sprint(pi_id: int, sprint_number: int, db: Session = Depends(get_db)):
    """Retourne les congés d'un PI pour un sprint spécifique."""
    return (
        db.query(Leave)
        .filter(Leave.pi_id == pi_id, Leave.sprint_number == sprint_number)
        .all()
    )


@router.post("/", response_model=LeaveResponse, status_code=201)
def create_leave(payload: LeaveCreate, db: Session = Depends(get_db)):
    """Crée un nouveau congé pour un membre sur un sprint donné."""
    leave = Leave(**payload.model_dump())
    db.add(leave)
    db.commit()
    db.refresh(leave)
    return leave


@router.put("/{leave_id}", response_model=LeaveResponse)
def update_leave(leave_id: int, payload: LeaveUpdate, db: Session = Depends(get_db)):
    """Met à jour la position, la durée ou le label d'un congé existant.

    Lève une erreur 404 si le congé n'existe pas.
    """
    leave = db.query(Leave).filter(Leave.id == leave_id).first()
    if not leave:
        raise HTTPException(status_code=404, detail="Congé non trouvé")
    for key, value in payload.model_dump(exclude_none=True).items():
        setattr(leave, key, value)
    db.commit()
    db.refresh(leave)
    return leave


@router.delete("/{leave_id}", status_code=204)
def delete_leave(leave_id: int, db: Session = Depends(get_db)):
    """Supprime définitivement un congé.

    Lève une erreur 404 si le congé n'existe pas.
    """
    leave = db.query(Leave).filter(Leave.id == leave_id).first()
    if not leave:
        raise HTTPException(status_code=404, detail="Congé non trouvé")
    db.delete(leave)
    db.commit()
