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
    group_id: int | None = None


class BlockUpdate(BaseModel):
    day_offset: float | None = None
    duration_days: float | None = None
    work_item_id: int | None = None
    is_locked: bool | None = None


class BlockGroupCreate(BaseModel):
    blocks: list[BlockCreate]


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
    is_locked: bool
    work_item_id: int | None
    group_id: int | None

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
    from app.models.iteration import Iteration
    iteration = db.query(Iteration).filter(
        Iteration.pi_id == payload.pi_id,
        Iteration.sprint_number == payload.sprint_number,
    ).first()
    start_date = iteration.start_date if iteration else None
    block = PlanningBlock(**payload.model_dump(), is_auto_generated=False, start_date=start_date)
    db.add(block)
    db.commit()
    db.refresh(block)
    return block


@router.put("/{block_id}", response_model=BlockResponse)
def update_block(block_id: int, payload: BlockUpdate, db: Session = Depends(get_db)):
    block = db.query(PlanningBlock).filter(PlanningBlock.id == block_id).first()
    if not block:
        raise HTTPException(status_code=404, detail="Bloc non trouvé")
    updates = payload.model_dump(exclude_none=True)
    # Propagate work_item_id to all blocks in the same group
    if "work_item_id" in updates and block.group_id is not None:
        db.query(PlanningBlock).filter(PlanningBlock.group_id == block.group_id).update(
            {"work_item_id": updates["work_item_id"]}
        )
        db.commit()
        db.refresh(block)
        return block
    for key, value in updates.items():
        setattr(block, key, value)
    db.commit()
    db.refresh(block)
    return block


@router.delete("/{block_id}", status_code=204)
def delete_block(block_id: int, db: Session = Depends(get_db)):
    block = db.query(PlanningBlock).filter(PlanningBlock.id == block_id).first()
    if not block:
        raise HTTPException(status_code=404, detail="Bloc non trouvé")
    # If part of a group, delete all group members
    if block.group_id is not None:
        db.query(PlanningBlock).filter(PlanningBlock.group_id == block.group_id).delete()
    else:
        db.delete(block)
    db.commit()


@router.post("/group", response_model=list[BlockResponse], status_code=201)
def create_block_group(payload: BlockGroupCreate, db: Session = Depends(get_db)):
    """Crée plusieurs blocs atomiquement et leur assigne un group_id commun."""
    from app.models.iteration import Iteration
    if not payload.blocks:
        raise HTTPException(status_code=400, detail="La liste de blocs est vide")
    created = []
    for block_data in payload.blocks:
        iteration = db.query(Iteration).filter(
            Iteration.pi_id == block_data.pi_id,
            Iteration.sprint_number == block_data.sprint_number,
        ).first()
        start_date = iteration.start_date if iteration else None
        block = PlanningBlock(
            **{k: v for k, v in block_data.model_dump().items() if k != "group_id"},
            is_auto_generated=False,
            start_date=start_date,
        )
        db.add(block)
        created.append(block)
    db.flush()  # assigns IDs without committing
    # group_id = id of the first block in the group
    group_id = created[0].id
    for block in created:
        block.group_id = group_id
    db.commit()
    for block in created:
        db.refresh(block)
    return created


@router.post("/pi/{pi_id}/generate", status_code=201)
def generate_planning(pi_id: int, db: Session = Depends(get_db)):
    """Supprime les blocs auto-générés et régénère depuis les matrices de capacité."""
    from app.services.capacity import generate_pi_planning
    try:
        generate_pi_planning(pi_id, db)
        return {"status": "ok", "message": "Calendrier capacitaire généré"}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/pi/{pi_id}/reset", status_code=204)
def reset_pi(
    pi_id: int,
    reset_leaves: bool = True,
    reset_stories: bool = True,
    reset_layer1: bool = True,
    db: Session = Depends(get_db),
):
    """Supprime sélectivement blocs et congés du PI selon les paramètres."""
    from app.models.leave import Leave
    if reset_layer1:
        db.query(PlanningBlock).filter(
            PlanningBlock.pi_id == pi_id,
            PlanningBlock.layer == 1,
        ).delete()
    if reset_stories:
        db.query(PlanningBlock).filter(
            PlanningBlock.pi_id == pi_id,
            PlanningBlock.layer == 2,
        ).delete()
    if reset_leaves:
        db.query(Leave).filter(Leave.pi_id == pi_id).delete()
    db.commit()


@router.delete("/pi/{pi_id}/sprint/{sprint_number}/reset", status_code=204)
def reset_sprint(
    pi_id: int,
    sprint_number: int,
    reset_leaves: bool = True,
    reset_stories: bool = True,
    reset_layer1: bool = True,
    db: Session = Depends(get_db),
):
    """Supprime sélectivement blocs et congés d'un sprint selon les paramètres."""
    from app.models.leave import Leave
    if reset_layer1:
        db.query(PlanningBlock).filter(
            PlanningBlock.pi_id == pi_id,
            PlanningBlock.sprint_number == sprint_number,
            PlanningBlock.layer == 1,
        ).delete()
    if reset_stories:
        db.query(PlanningBlock).filter(
            PlanningBlock.pi_id == pi_id,
            PlanningBlock.sprint_number == sprint_number,
            PlanningBlock.layer == 2,
        ).delete()
    if reset_leaves:
        db.query(Leave).filter(
            Leave.pi_id == pi_id,
            Leave.sprint_number == sprint_number,
        ).delete()
    db.commit()
