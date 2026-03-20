from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models.team_member import TeamMember

router = APIRouter()


class TeamMemberCreate(BaseModel):
    display_name: str
    unique_name: str | None = None
    profile: str = "Dev"  # Dev, QA, PSM


class TeamMemberUpdate(BaseModel):
    display_name: str | None = None
    profile: str | None = None
    is_active: bool | None = None


class TeamMemberResponse(BaseModel):
    id: int
    azdo_id: str | None
    display_name: str
    unique_name: str | None
    profile: str
    is_active: bool

    class Config:
        from_attributes = True


@router.get("/", response_model=list[TeamMemberResponse])
def list_team_members(db: Session = Depends(get_db)):
    return db.query(TeamMember).filter(TeamMember.is_active == True).all()


@router.post("/", response_model=TeamMemberResponse, status_code=201)
def create_team_member(payload: TeamMemberCreate, db: Session = Depends(get_db)):
    member = TeamMember(**payload.model_dump())
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


@router.put("/{member_id}", response_model=TeamMemberResponse)
def update_team_member(member_id: int, payload: TeamMemberUpdate, db: Session = Depends(get_db)):
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
    member = db.query(TeamMember).filter(TeamMember.id == member_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Membre non trouvé")
    member.is_active = False
    db.commit()
