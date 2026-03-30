"""Synchronisation AZDO incrémentale — ne récupère que les WI modifiés depuis la dernière sync."""
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from app.models.app_settings import AppSettings
from app.services.azdo.sync import AzdoSyncService


LAST_SYNC_KEY = "azdo_last_incremental_sync"


async def run_incremental_sync(db: Session, lookback_days: int = 1) -> dict:
    """
    Synchronise uniquement les work items modifiés depuis la dernière sync incrémentale.

    Utilise ``AzdoSyncService.sync_all()`` avec un filtre ``since_date`` calculé
    à partir de la dernière exécution mémorisée en base (clé ``azdo_last_incremental_sync``).
    Si aucune date n'est mémorisée, un lookback de ``lookback_days`` jours est appliqué.

    Returns:
        dict avec les compteurs de la sync (items_synced, counts, since).
    """
    # Déterminer la date de départ
    last_sync_row = db.query(AppSettings).filter(AppSettings.key == LAST_SYNC_KEY).first()
    if last_sync_row and last_sync_row.value:
        try:
            since_dt = datetime.fromisoformat(last_sync_row.value)
        except ValueError:
            since_dt = datetime.utcnow() - timedelta(days=lookback_days)
    else:
        since_dt = datetime.utcnow() - timedelta(days=lookback_days)

    sync_service = AzdoSyncService(db)

    # Déléguer à sync_all avec le filtre de date — réutilise toute la logique d'upsert existante
    result = await sync_service.sync_all(full_sync=False, since_date=since_dt)

    # Mettre à jour la date de dernière sync incrémentale
    _update_last_sync(db)

    return {
        "items_synced": result.get("items_synced", 0),
        "counts": result.get("counts", {}),
        "since": since_dt.isoformat(),
    }


def _update_last_sync(db: Session) -> None:
    """Enregistre la date UTC courante comme dernière sync incrémentale."""
    now_str = datetime.utcnow().isoformat()
    row = db.query(AppSettings).filter(AppSettings.key == LAST_SYNC_KEY).first()
    if row:
        row.value = now_str
    else:
        db.add(AppSettings(key=LAST_SYNC_KEY, value=now_str))
    db.commit()
