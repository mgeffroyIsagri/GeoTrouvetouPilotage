"""Modèle ORM pour les Work Items synchronisés depuis Azure DevOps."""

from datetime import datetime
from sqlalchemy import Integer, String, Float, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class WorkItem(Base):
    """Work Item AZDO synchronisé en lecture seule dans la base locale.

    La clé primaire ``id`` correspond directement à l'identifiant AZDO du
    work item (pas d'auto-incrément). Les types courants sont :
    ``User Story``, ``Enabler Story``, ``Maintenance``, ``Bug``, ``Task``,
    ``Feature``, ``Enabler``.

    Les champs ``original_estimate``, ``completed_work`` et
    ``remaining_work`` sont exprimés en heures (valeurs AZDO).
    ``story_points`` et ``effort`` sont des estimations en points.

    Tous les champs sont mis à jour lors de la synchronisation via
    ``azdo/sync.py``. Aucune écriture n'est effectuée vers AZDO.
    """

    __tablename__ = "work_items"

    # ID AZDO (pas d'auto-incrément : on utilise l'ID AZDO directement)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Type AZDO : User Story, Enabler Story, Maintenance, Bug, Task, Feature, Enabler
    type: Mapped[str] = mapped_column(String(50))
    title: Mapped[str] = mapped_column(String(500))
    state: Mapped[str | None] = mapped_column(String(100))
    iteration_path: Mapped[str | None] = mapped_column(String(500))
    assigned_to: Mapped[str | None] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    acceptance_criteria: Mapped[str | None] = mapped_column(Text)
    # Estimation en story points (Features / Enablers)
    story_points: Mapped[float | None] = mapped_column(Float)
    # Estimations en heures (Tasks / User Stories)
    original_estimate: Mapped[float | None] = mapped_column(Float)
    completed_work: Mapped[float | None] = mapped_column(Float)
    remaining_work: Mapped[float | None] = mapped_column(Float)
    # ID du parent AZDO (non résolu en FK pour rester léger)
    parent_id: Mapped[int | None] = mapped_column(Integer)
    business_value: Mapped[float | None] = mapped_column(Float)
    effort: Mapped[float | None] = mapped_column(Float)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime)
    iteration_id: Mapped[int | None] = mapped_column(ForeignKey("iterations.id"))

    # ── Relations ──────────────────────────────────────────────────────────────
    iteration: Mapped["Iteration | None"] = relationship(back_populates="work_items")
    planning_blocks: Mapped[list["PlanningBlock"]] = relationship(back_populates="work_item")
