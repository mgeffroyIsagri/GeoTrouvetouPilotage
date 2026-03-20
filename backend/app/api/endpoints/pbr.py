from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime

from app.database import get_db
from app.models.pbr import PBRSession, PBRVote

router = APIRouter()


class SessionCreate(BaseModel):
    name: str
    date: datetime
    pi_id: int | None = None


class SessionResponse(BaseModel):
    id: int
    name: str
    date: datetime
    is_active: bool
    pi_id: int | None

    class Config:
        from_attributes = True


class VoteCreate(BaseModel):
    session_id: int
    team_member_id: int
    work_item_id: int
    dor_note: int | None = None
    comment: str | None = None
    story_points: float | None = None
    charge_dev_days: float | None = None
    charge_qa_days: float | None = None


class VoteResponse(BaseModel):
    id: int
    session_id: int
    team_member_id: int
    work_item_id: int
    dor_note: int | None
    comment: str | None
    story_points: float | None
    charge_dev_days: float | None
    charge_qa_days: float | None
    ia_dor_note: int | None
    ia_comment: str | None
    action_plan: str | None

    class Config:
        from_attributes = True


@router.get("/sessions", response_model=list[SessionResponse])
def list_sessions(db: Session = Depends(get_db)):
    return db.query(PBRSession).order_by(PBRSession.date.desc()).all()


@router.post("/sessions", response_model=SessionResponse, status_code=201)
def create_session(payload: SessionCreate, db: Session = Depends(get_db)):
    # Désactiver les sessions actives
    db.query(PBRSession).filter(PBRSession.is_active == True).update({"is_active": False})
    session = PBRSession(**payload.model_dump(), is_active=True)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.get("/sessions/{session_id}/votes", response_model=list[VoteResponse])
def get_votes(session_id: int, db: Session = Depends(get_db)):
    return db.query(PBRVote).filter(PBRVote.session_id == session_id).all()


@router.post("/votes", response_model=VoteResponse, status_code=201)
def create_vote(payload: VoteCreate, db: Session = Depends(get_db)):
    vote = PBRVote(**payload.model_dump())
    db.add(vote)
    db.commit()
    db.refresh(vote)
    return vote


@router.put("/votes/{vote_id}/action-plan", response_model=VoteResponse)
def set_action_plan(vote_id: int, action_plan: str, db: Session = Depends(get_db)):
    vote = db.query(PBRVote).filter(PBRVote.id == vote_id).first()
    if not vote:
        raise HTTPException(status_code=404, detail="Vote non trouvé")
    vote.action_plan = action_plan
    db.commit()
    db.refresh(vote)
    return vote
