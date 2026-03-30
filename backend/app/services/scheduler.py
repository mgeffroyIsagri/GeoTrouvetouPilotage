"""Scheduler APScheduler pour les triggers d'automatisation."""
import json
import time
import logging
from datetime import datetime
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None
_db_factory = None


def get_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler is None:
        _scheduler = AsyncIOScheduler(timezone="UTC")
    return _scheduler


def init_scheduler(db_factory):
    """Initialise et démarre le scheduler. Appelé au démarrage de FastAPI."""
    global _db_factory
    _db_factory = db_factory
    scheduler = get_scheduler()
    if not scheduler.running:
        scheduler.start()
        logger.info("APScheduler démarré")
    # Charger les triggers depuis la DB
    _reload_all_triggers()


def _reload_all_triggers():
    """Charge tous les triggers actifs depuis la DB et les enregistre dans le scheduler."""
    if _db_factory is None:
        return
    db: Session = next(_db_factory())
    try:
        from app.models.trigger import Trigger
        triggers = db.query(Trigger).filter(Trigger.enabled == True).all()
        for trigger in triggers:
            _register_job(trigger)
    except Exception as exc:
        logger.error(f"Erreur lors du chargement des triggers: {exc}")
    finally:
        db.close()


def _make_apscheduler_trigger(trigger):
    """Convertit les paramètres du trigger en objet APScheduler trigger."""
    stype = trigger.schedule_type
    sval = trigger.schedule_value
    if stype == "interval":
        # sval = nombre de minutes
        return IntervalTrigger(minutes=int(sval))
    elif stype == "daily":
        # sval = "HH:MM"
        hour, minute = sval.split(":")
        return CronTrigger(hour=int(hour), minute=int(minute))
    elif stype == "cron":
        # sval = expression cron "min heure jour mois joursemaine"
        parts = sval.split()
        if len(parts) == 5:
            return CronTrigger(
                minute=parts[0],
                hour=parts[1],
                day=parts[2],
                month=parts[3],
                day_of_week=parts[4],
            )
    raise ValueError(f"Type de schedule inconnu: {stype}")


def _register_job(trigger):
    """Enregistre ou remplace un job APScheduler pour ce trigger."""
    scheduler = get_scheduler()
    job_id = f"trigger_{trigger.id}"
    # Supprimer le job existant s'il existe
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
    try:
        aps_trigger = _make_apscheduler_trigger(trigger)
        scheduler.add_job(
            _execute_trigger,
            trigger=aps_trigger,
            id=job_id,
            args=[trigger.id],
            replace_existing=True,
            misfire_grace_time=300,
        )
        logger.info(f"Job enregistré: trigger#{trigger.id} ({trigger.name})")
    except Exception as e:
        logger.error(f"Impossible d'enregistrer trigger#{trigger.id}: {e}")


def register_trigger(trigger):
    """Appelé depuis l'API après création/modification d'un trigger."""
    if trigger.enabled:
        _register_job(trigger)
    else:
        unregister_trigger(trigger.id)


def unregister_trigger(trigger_id: int):
    """Supprime le job APScheduler pour ce trigger."""
    scheduler = get_scheduler()
    job_id = f"trigger_{trigger_id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)


def get_next_run(trigger_id: int) -> datetime | None:
    """Retourne la prochaine date d'exécution prévue."""
    scheduler = get_scheduler()
    job = scheduler.get_job(f"trigger_{trigger_id}")
    return job.next_run_time if job else None


async def _execute_trigger(trigger_id: int):
    """Exécute l'action d'un trigger et enregistre le log."""
    if _db_factory is None:
        return
    db: Session = next(_db_factory())
    try:
        from app.models.trigger import Trigger, TriggerLog
        trigger = db.query(Trigger).filter(Trigger.id == trigger_id).first()
        if not trigger or not trigger.enabled:
            return

        trigger.last_run_status = "running"
        trigger.last_run_at = datetime.utcnow()
        db.commit()

        t0 = time.monotonic()
        result_detail: dict = {}
        status = "error"
        summary = ""

        try:
            result_detail = await _run_action(trigger, db)
            status = "success"
            summary = json.dumps(result_detail, ensure_ascii=False)[:400]
        except Exception as exc:
            summary = str(exc)[:400]
            result_detail = {"error": str(exc)}
            logger.error(f"Erreur trigger#{trigger_id}: {exc}")

        duration_ms = int((time.monotonic() - t0) * 1000)

        trigger.last_run_status = status
        trigger.last_run_summary = summary
        trigger.last_run_at = datetime.utcnow()
        trigger.next_run_at = get_next_run(trigger_id)
        db.commit()

        db.add(TriggerLog(
            trigger_id=trigger_id,
            ran_at=datetime.utcnow(),
            status=status,
            duration_ms=duration_ms,
            result_summary=summary,
            result_detail=json.dumps(result_detail, ensure_ascii=False),
        ))
        db.commit()

    finally:
        db.close()


async def _run_action(trigger, db: Session) -> dict:
    """Dispatch vers l'action correspondante."""
    params = json.loads(trigger.action_params) if trigger.action_params else {}

    if trigger.action_type == "azdo_sync_incremental":
        from app.services.azdo.sync_incremental import run_incremental_sync
        lookback_days = int(params.get("lookback_days", 1))
        return await run_incremental_sync(db, lookback_days=lookback_days)

    raise ValueError(f"Action inconnue: {trigger.action_type}")


def shutdown_scheduler():
    """Arrête le scheduler proprement."""
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("APScheduler arrêté")
