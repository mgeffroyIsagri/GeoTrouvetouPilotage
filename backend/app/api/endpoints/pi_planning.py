from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models.pi_planning import PlanningBlock

router = APIRouter()


class BlockCreate(BaseModel):
    pi_id: int
    team_member_id: int
    sprint_number: int
    day_offset: float
    duration_days: float
    category: str
    layer: int = 1
    work_item_id: int | None = None


class BlockUpdate(BaseModel):
    day_offset: float | None = None
    duration_days: float | None = None
    work_item_id: int | None = None


class BlockResponse(BaseModel):
    id: int
    pi_id: int
    team_member_id: int
    sprint_number: int
    day_offset: float
    start_date: date | None
    duration_days: float
    category: str
    layer: int
    is_auto_generated: bool
    work_item_id: int | None

    class Config:
        from_attributes = True


@router.get("/pi/{pi_id}", response_model=list[BlockResponse])
def get_blocks_for_pi(pi_id: int, db: Session = Depends(get_db)):
    return db.query(PlanningBlock).filter(PlanningBlock.pi_id == pi_id).all()


@router.get("/pi/{pi_id}/sprint/{sprint_number}", response_model=list[BlockResponse])
def get_blocks_for_sprint(pi_id: int, sprint_number: int, db: Session = Depends(get_db)):
    return (
        db.query(PlanningBlock)
        .filter(PlanningBlock.pi_id == pi_id, PlanningBlock.sprint_number == sprint_number)
        .all()
    )


@router.post("/", response_model=BlockResponse, status_code=201)
def create_block(payload: BlockCreate, db: Session = Depends(get_db)):
    block = PlanningBlock(**payload.model_dump(), is_auto_generated=False)
    db.add(block)
    db.commit()
    db.refresh(block)
    return block


@router.put("/{block_id}", response_model=BlockResponse)
def update_block(block_id: int, payload: BlockUpdate, db: Session = Depends(get_db)):
    block = db.query(PlanningBlock).filter(PlanningBlock.id == block_id).first()
    if not block:
        raise HTTPException(status_code=404, detail="Bloc non trouvé")
    for key, value in payload.model_dump(exclude_none=True).items():
        setattr(block, key, value)
    db.commit()
    db.refresh(block)
    return block


@router.delete("/{block_id}", status_code=204)
def delete_block(block_id: int, db: Session = Depends(get_db)):
    block = db.query(PlanningBlock).filter(PlanningBlock.id == block_id).first()
    if not block:
        raise HTTPException(status_code=404, detail="Bloc non trouvé")
    db.delete(block)
    db.commit()


@router.post("/pi/{pi_id}/generate", status_code=201)
def generate_planning(pi_id: int, db: Session = Depends(get_db)):
    """Supprime les blocs auto-générés et régénère depuis les matrices de capacité."""
    from app.services.capacity import generate_pi_planning
    try:
        generate_pi_planning(pi_id, db)
        return {"status": "ok", "message": "Calendrier capacitaire généré"}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
