"""Modèle ORM pour les capacités manuelles par sprint et par membre."""

from sqlalchemy import Integer, Float, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class SprintCapacity(Base):
    """Capacité effective d'un membre pour un sprint donné, exprimée en heures.

    Ces données sont saisies ou importées manuellement depuis les blocs
    Layer 1 via ``POST /suivi/pi/{id}/sprint/{n}/capacities/import``. Elles
    servent de base de calcul pour les KPIs du module Suivi.

    La contrainte d'unicité ``(pi_id, sprint_number, team_member_id)`` garantit
    un seul enregistrement de capacité par membre et par sprint.

    Tous les champs ``capa_*_h`` sont exprimés en heures (float).
    """

    __tablename__ = "sprint_capacity"
    __table_args__ = (UniqueConstraint("pi_id", "sprint_number", "team_member_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pi_id: Mapped[int] = mapped_column(Integer, ForeignKey("pi.id"), nullable=False)
    sprint_number: Mapped[int] = mapped_column(Integer, nullable=False)
    team_member_id: Mapped[int] = mapped_column(Integer, ForeignKey("team_members.id"), nullable=False)

    # ── Capacités par catégorie (en heures) ────────────────────────────────────
    capa_stories_h: Mapped[float] = mapped_column(Float, default=0.0)
    capa_bugs_h: Mapped[float] = mapped_column(Float, default=0.0)
    capa_imprevus_h: Mapped[float] = mapped_column(Float, default=0.0)
    capa_agility_h: Mapped[float] = mapped_column(Float, default=0.0)
    capa_reunions_h: Mapped[float] = mapped_column(Float, default=0.0)
    capa_psm_h: Mapped[float] = mapped_column(Float, default=0.0)
    capa_montee_h: Mapped[float] = mapped_column(Float, default=0.0)
