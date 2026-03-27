"""Endpoints CRUD pour la gestion des membres de l'équipe."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models.team_member import TeamMember

router = APIRouter()


# ── Schémas Pydantic ───────────────────────────────────────────────────────────

class TeamMemberCreate(BaseModel):
    """Corps de création d'un membre de l'équipe."""

    display_name: str
    unique_name: str | None = None
    # Profil déterminant la matrice de capacité : Dev, QA, PSM, Squad Lead, Automate
    profile: str = "Dev"


class TeamMemberUpdate(BaseModel):
    """Corps de mise à jour partielle d'un membre (champs optionnels)."""

    display_name: str | None = None
    profile: str | None = None
    is_active: bool | None = None


class TeamMemberResponse(BaseModel):
    """Représentation d'un membre retourné par l'API."""

    id: int
    azdo_id: str | None
    display_name: str
    unique_name: str | None
    profile: str
    is_active: bool

    class Config:
        from_attributes = True


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[TeamMemberResponse])
def list_team_members(db: Session = Depends(get_db)):
    """Retourne la liste des membres actifs de l'équipe."""
    return db.query(TeamMember).filter(TeamMember.is_active == True).all()


@router.post("/", response_model=TeamMemberResponse, status_code=201)
def create_team_member(payload: TeamMemberCreate, db: Session = Depends(get_db)):
    """Crée un nouveau membre de l'équipe."""
    member = TeamMember(**payload.model_dump())
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


@router.put("/{member_id}", response_model=TeamMemberResponse)
def update_team_member(member_id: int, payload: TeamMemberUpdate, db: Session = Depends(get_db)):
    """Met à jour les informations d'un membre existant.

    Lève une erreur 404 si le membre n'existe pas.
    """
    member = db.query(TeamMember).filter(TeamMember.id == member_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Membre non trouvé")
    for key, value in payload.model_dump(exclude_none=True).items():
        setattr(member, key, value)
    db.commit()
    db.refresh(member)
    return member


@router.delete("/{member_id}", status_code=204)
def delete_team_member(member_id: int, db: Session = Depends(get_db)):
    """Archive un membre (suppression logique : is_active = False).

    Le membre n'est pas supprimé de la base pour préserver l'historique
    des votes PBR et des blocs de planning associés.
    Lève une erreur 404 si le membre n'existe pas.
    """
    member = db.query(TeamMember).filter(TeamMember.id == member_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Membre non trouvé")
    member.is_active = False
    db.commit()
