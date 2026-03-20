from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models.pi import PI
from app.models.iteration import Iteration

router = APIRouter()

SPRINT_WEEKS = [3, 3, 4, 3]
SPRINT_LABELS = ["Sprint 1", "Sprint 2", "Sprint 3", "IP Sprint"]


class PICreate(BaseModel):
    name: str
    start_date: date  # Doit être un vendredi
    azdo_iteration_path: str | None = None


class PIResponse(BaseModel):
    id: int
    name: str
    start_date: date
    end_date: date
    azdo_iteration_path: str | None
    is_active: bool

    class Config:
        from_attributes = True


class IterationResponse(BaseModel):
    id: int
    name: str
    sprint_number: int | None
    start_date: date | None
    end_date: date | None

    class Config:
        from_attributes = True


def _create_sprints(pi: PI, db: Session) -> None:
    """Auto-crée les 4 sprints à partir de pi.start_date (vendredi)."""
    cursor = pi.start_date
    for i, (weeks, label) in enumerate(zip(SPRINT_WEEKS, SPRINT_LABELS), start=1):
        end = cursor + timedelta(weeks=weeks) - timedelta(days=1)  # se termine le jeudi
        db.add(Iteration(
            name=f"{pi.name} — {label}",
            sprint_number=i,
            pi_id=pi.id,
            start_date=cursor,
            end_date=end,
        ))
        cursor = end + timedelta(days=1)  # vendredi suivant
    pi.end_date = cursor - timedelta(days=1)


@router.get("/", response_model=list[PIResponse])
def list_pi(db: Session = Depends(get_db)):
    return db.query(PI).order_by(PI.start_date.desc()).all()


@router.post("/", response_model=PIResponse, status_code=201)
def create_pi(payload: PICreate, db: Session = Depends(get_db)):
    # Validation : start_date doit être un vendredi (weekday() == 4)
    if payload.start_date.weekday() != 4:
        raise HTTPException(
            status_code=400,
            detail=f"La date de début doit être un vendredi ({payload.start_date} est un {payload.start_date.strftime('%A')})",
        )
    pi = PI(name=payload.name, start_date=payload.start_date, end_date=payload.start_date,
            azdo_iteration_path=payload.azdo_iteration_path)
    db.add(pi)
    db.flush()  # obtenir pi.id
    _create_sprints(pi, db)
    db.commit()
    db.refresh(pi)
    return pi


@router.get("/{pi_id}", response_model=PIResponse)
def get_pi(pi_id: int, db: Session = Depends(get_db)):
    pi = db.query(PI).filter(PI.id == pi_id).first()
    if not pi:
        raise HTTPException(status_code=404, detail="PI non trouvé")
    return pi


@router.get("/{pi_id}/iterations", response_model=list[IterationResponse])
def get_pi_iterations(pi_id: int, db: Session = Depends(get_db)):
    return (
        db.query(Iteration)
        .filter(Iteration.pi_id == pi_id)
        .order_by(Iteration.sprint_number)
        .all()
    )


@router.put("/{pi_id}/activate", response_model=PIResponse)
def activate_pi(pi_id: int, db: Session = Depends(get_db)):
    db.query(PI).update({"is_active": False})
    pi = db.query(PI).filter(PI.id == pi_id).first()
    if not pi:
        raise HTTPException(status_code=404, detail="PI non trouvé")
    pi.is_active = True
    db.commit()
    db.refresh(pi)
    return pi


@router.delete("/{pi_id}", status_code=204)
def delete_pi(pi_id: int, db: Session = Depends(get_db)):
    pi = db.query(PI).filter(PI.id == pi_id).first()
    if not pi:
        raise HTTPException(status_code=404, detail="PI non trouvé")
    db.delete(pi)
    db.commit()
