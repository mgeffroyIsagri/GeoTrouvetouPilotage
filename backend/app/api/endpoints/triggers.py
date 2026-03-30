"""Endpoints REST pour la gestion des triggers d'automatisation."""
import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.trigger import Trigger, TriggerLog
from app.services.scheduler import register_trigger, unregister_trigger, get_next_run, _execute_trigger

router = APIRouter(prefix="/triggers", tags=["Triggers"])


class TriggerCreate(BaseModel):
    name: str
    action_type: str
    action_params: dict | None = None
    schedule_type: str  # "interval" | "daily" | "cron"
    schedule_value: str
    enabled: bool = True


class TriggerUpdate(BaseModel):
    name: str | None = None
    action_type: str | None = None
    action_params: dict | None = None
    schedule_type: str | None = None
    schedule_value: str | None = None
    enabled: bool | None = None


def _to_dict(t: Trigger) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "action_type": t.action_type,
        "action_params": json.loads(t.action_params) if t.action_params else {},
        "schedule_type": t.schedule_type,
        "schedule_value": t.schedule_value,
        "enabled": t.enabled,
        "last_run_at": t.last_run_at.isoformat() if t.last_run_at else None,
        "last_run_status": t.last_run_status,
        "last_run_summary": t.last_run_summary,
        "next_run_at": t.next_run_at.isoformat() if t.next_run_at else None,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


@router.get("/")
def list_triggers(db: Session = Depends(get_db)):
    """Retourne la liste de tous les triggers avec leur prochaine exécution."""
    triggers = db.query(Trigger).order_by(Trigger.created_at.desc()).all()
    result = []
    for t in triggers:
        d = _to_dict(t)
        next_run = get_next_run(t.id)
        if next_run:
            d["next_run_at"] = next_run.isoformat()
        result.append(d)
    return result


@router.post("/", status_code=201)
def create_trigger(payload: TriggerCreate, db: Session = Depends(get_db)):
    """Crée un nouveau trigger et l'enregistre dans le scheduler si activé."""
    trigger = Trigger(
        name=payload.name,
        action_type=payload.action_type,
        action_params=json.dumps(payload.action_params) if payload.action_params else None,
        schedule_type=payload.schedule_type,
        schedule_value=payload.schedule_value,
        enabled=payload.enabled,
        created_at=datetime.utcnow(),
    )
    db.add(trigger)
    db.commit()
    db.refresh(trigger)
    register_trigger(trigger)
    next_run = get_next_run(trigger.id)
    if next_run:
        trigger.next_run_at = next_run
        db.commit()
    return _to_dict(trigger)


@router.get("/{trigger_id}")
def get_trigger(trigger_id: int, db: Session = Depends(get_db)):
    """Retourne un trigger par son ID."""
    t = db.query(Trigger).filter(Trigger.id == trigger_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Trigger non trouvé")
    return _to_dict(t)


@router.put("/{trigger_id}")
def update_trigger(trigger_id: int, payload: TriggerUpdate, db: Session = Depends(get_db)):
    """Met à jour un trigger existant et reconfigure le scheduler."""
    t = db.query(Trigger).filter(Trigger.id == trigger_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Trigger non trouvé")
    if payload.name is not None:
        t.name = payload.name
    if payload.action_type is not None:
        t.action_type = payload.action_type
    if payload.action_params is not None:
        t.action_params = json.dumps(payload.action_params)
    if payload.schedule_type is not None:
        t.schedule_type = payload.schedule_type
    if payload.schedule_value is not None:
        t.schedule_value = payload.schedule_value
    if payload.enabled is not None:
        t.enabled = payload.enabled
    db.commit()
    db.refresh(t)
    register_trigger(t)
    next_run = get_next_run(t.id)
    if next_run:
        t.next_run_at = next_run
        db.commit()
    return _to_dict(t)


@router.delete("/{trigger_id}", status_code=204)
def delete_trigger(trigger_id: int, db: Session = Depends(get_db)):
    """Supprime un trigger et désenregistre son job du scheduler."""
    t = db.query(Trigger).filter(Trigger.id == trigger_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Trigger non trouvé")
    unregister_trigger(trigger_id)
    db.delete(t)
    db.commit()


@router.patch("/{trigger_id}/toggle")
def toggle_trigger(trigger_id: int, db: Session = Depends(get_db)):
    """Active ou désactive un trigger."""
    t = db.query(Trigger).filter(Trigger.id == trigger_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Trigger non trouvé")
    t.enabled = not t.enabled
    db.commit()
    register_trigger(t)
    return _to_dict(t)


@router.post("/{trigger_id}/run")
async def run_trigger_now(trigger_id: int, db: Session = Depends(get_db)):
    """Exécute immédiatement un trigger (en dehors du planning)."""
    t = db.query(Trigger).filter(Trigger.id == trigger_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Trigger non trouvé")
    await _execute_trigger(trigger_id)
    db.refresh(t)
    return _to_dict(t)


@router.get("/{trigger_id}/logs")
def get_trigger_logs(trigger_id: int, limit: int = 50, db: Session = Depends(get_db)):
    """Retourne les derniers logs d'exécution d'un trigger."""
    logs = (
        db.query(TriggerLog)
        .filter(TriggerLog.trigger_id == trigger_id)
        .order_by(TriggerLog.ran_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": log.id,
            "ran_at": log.ran_at.isoformat(),
            "status": log.status,
            "duration_ms": log.duration_ms,
            "result_summary": log.result_summary,
            "result_detail": json.loads(log.result_detail) if log.result_detail else None,
        }
        for log in logs
    ]
