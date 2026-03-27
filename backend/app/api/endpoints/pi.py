"""Endpoints CRUD pour la gestion des Programme Increments (PI)."""

from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models.pi import PI
from app.models.iteration import Iteration

router = APIRouter()

# ── Constantes ─────────────────────────────────────────────────────────────────

# Durée de chaque sprint en semaines (Sprint 1, 2, 3, IP Sprint)
SPRINT_WEEKS = [3, 3, 4, 3]
# Labels des sprints utilisés dans les noms d'itération
SPRINT_LABELS = ["Sprint 1", "Sprint 2", "Sprint 3", "IP Sprint"]

# Numéro du jour de la semaine correspondant au vendredi (convention Python)
_WEEKDAY_FRIDAY = 4


# ── Schémas Pydantic ───────────────────────────────────────────────────────────

class PICreate(BaseModel):
    """Corps de création d'un PI.

    ``start_date`` doit obligatoirement être un vendredi.
    """

    name: str
    start_date: date  # Doit être un vendredi
    azdo_iteration_path: str | None = None


class PIResponse(BaseModel):
    """Représentation d'un PI retourné par l'API."""

    id: int
    name: str
    start_date: date
    end_date: date
    azdo_iteration_path: str | None
    is_active: bool
    is_locked: bool

    class Config:
        from_attributes = True


class IterationResponse(BaseModel):
    """Représentation d'une itération (sprint) retournée par l'API."""

    id: int
    name: str
    sprint_number: int | None
    start_date: date | None
    end_date: date | None

    class Config:
        from_attributes = True


# ── Helpers ────────────────────────────────────────────────────────────────────

def _create_sprints(pi: PI, db: Session) -> None:
    """Auto-crée les 4 sprints du PI à partir de ``pi.start_date`` (vendredi).

    Chaque sprint démarre le vendredi suivant la fin du sprint précédent.
    La durée de chaque sprint est définie par ``SPRINT_WEEKS``.
    Met également à jour ``pi.end_date`` avec la date de fin du dernier sprint.
    """
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


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[PIResponse])
def list_pi(db: Session = Depends(get_db)):
    """Retourne la liste de tous les PIs, triés par date de début décroissante."""
    return db.query(PI).order_by(PI.start_date.desc()).all()


@router.post("/", response_model=PIResponse, status_code=201)
def create_pi(payload: PICreate, db: Session = Depends(get_db)):
    """Crée un nouveau PI avec ses 4 sprints auto-générés.

    Valide que ``start_date`` est bien un vendredi avant de créer le PI et
    ses itérations. Lève une erreur 400 si la date n'est pas un vendredi.
    """
    # Validation : start_date doit être un vendredi (weekday() == 4)
    if payload.start_date.weekday() != _WEEKDAY_FRIDAY:
        raise HTTPException(
            status_code=400,
            detail=f"La date de début doit être un vendredi ({payload.start_date} est un {payload.start_date.strftime('%A')})",
        )
    pi = PI(name=payload.name, start_date=payload.start_date, end_date=payload.start_date,
            azdo_iteration_path=payload.azdo_iteration_path)
    db.add(pi)
    db.flush()  # obtenir pi.id avant de créer les sprints
    _create_sprints(pi, db)
    db.commit()
    db.refresh(pi)
    return pi


@router.get("/{pi_id}", response_model=PIResponse)
def get_pi(pi_id: int, db: Session = Depends(get_db)):
    """Retourne un PI par son identifiant.

    Lève une erreur 404 si le PI n'existe pas.
    """
    pi = db.query(PI).filter(PI.id == pi_id).first()
    if not pi:
        raise HTTPException(status_code=404, detail="PI non trouvé")
    return pi


@router.get("/{pi_id}/iterations", response_model=list[IterationResponse])
def get_pi_iterations(pi_id: int, db: Session = Depends(get_db)):
    """Retourne les itérations (sprints) d'un PI, triées par numéro de sprint."""
    return (
        db.query(Iteration)
        .filter(Iteration.pi_id == pi_id)
        .order_by(Iteration.sprint_number)
        .all()
    )


@router.put("/{pi_id}/activate", response_model=PIResponse)
def activate_pi(pi_id: int, db: Session = Depends(get_db)):
    """Active un PI et désactive tous les autres.

    Un seul PI peut être actif à la fois. Lève une erreur 404 si le PI
    demandé n'existe pas.
    """
    # Désactiver tous les PIs existants avant d'activer le nouveau
    db.query(PI).update({"is_active": False})
    pi = db.query(PI).filter(PI.id == pi_id).first()
    if not pi:
        raise HTTPException(status_code=404, detail="PI non trouvé")
    pi.is_active = True
    db.commit()
    db.refresh(pi)
    return pi


@router.put("/{pi_id}/lock", response_model=PIResponse)
def lock_pi(pi_id: int, db: Session = Depends(get_db)):
    """Verrouille un PI : le planning passe en lecture seule et le panel admin devient accessible."""
    pi = db.query(PI).filter(PI.id == pi_id).first()
    if not pi:
        raise HTTPException(status_code=404, detail="PI non trouvé")
    pi.is_locked = True
    db.commit()
    db.refresh(pi)
    return pi


@router.put("/{pi_id}/unlock", response_model=PIResponse)
def unlock_pi(pi_id: int, db: Session = Depends(get_db)):
    """Déverrouille un PI : le planning redevient éditable."""
    pi = db.query(PI).filter(PI.id == pi_id).first()
    if not pi:
        raise HTTPException(status_code=404, detail="PI non trouvé")
    pi.is_locked = False
    db.commit()
    db.refresh(pi)
    return pi


@router.delete("/{pi_id}", status_code=204)
def delete_pi(pi_id: int, db: Session = Depends(get_db)):
    """Supprime définitivement un PI et toutes ses données en cascade.

    La suppression est propagée aux itérations et aux blocs de planning
    via les relations ``cascade="all, delete-orphan"``.
    Lève une erreur 404 si le PI n'existe pas.
    """
    pi = db.query(PI).filter(PI.id == pi_id).first()
    if not pi:
        raise HTTPException(status_code=404, detail="PI non trouvé")
    db.delete(pi)
    db.commit()
