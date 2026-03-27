"""Modèle ORM pour les logs de synchronisation Azure DevOps."""

from datetime import datetime
from sqlalchemy import Integer, String, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class SyncLog(Base):
    """Enregistrement d'une synchronisation Azure DevOps.

    Un log est créé après chaque appel à ``sync_all()`` depuis l'endpoint
    ``POST /azdo/sync``. Le champ ``details`` contient un JSON avec le
    nombre d'items synchronisés par type (ex: ``{"Feature": 12, "User Story": 47}``).

    Valeurs de ``status`` : ``"success"`` ou ``"error"``.
    """

    __tablename__ = "sync_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    # Résultat de la synchronisation : "success" ou "error"
    status: Mapped[str] = mapped_column(String(20))
    # JSON : nombre d'items synchronisés par type AZDO (ex: {"Feature": 12})
    details: Mapped[str | None] = mapped_column(Text)
    items_synced: Mapped[int] = mapped_column(Integer, default=0)
