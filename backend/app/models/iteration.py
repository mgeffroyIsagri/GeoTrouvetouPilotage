"""Modèle ORM pour les itérations (sprints) d'un PI."""

from datetime import date
from sqlalchemy import Integer, String, Date, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Iteration(Base):
    """Sprint appartenant à un PI.

    Les 4 itérations d'un PI sont auto-créées à la création du PI via
    ``_create_sprints()``. Le ``sprint_number`` va de 1 à 4 (le 4e étant
    l'IP Sprint). Un sprint peut être lié à une itération Azure DevOps via
    ``azdo_id``.
    """

    __tablename__ = "iterations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Identifiant unique AZDO (GUID), nullable si créé manuellement
    azdo_id: Mapped[str | None] = mapped_column(String(100), unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # Chemin complet de l'itération AZDO (ex: "MonProjet\\PI 2025-1\\Sprint 1")
    path: Mapped[str | None] = mapped_column(String(500))
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    # Numéro du sprint dans le PI : 1 à 4
    sprint_number: Mapped[int | None] = mapped_column(Integer)
    pi_id: Mapped[int | None] = mapped_column(ForeignKey("pi.id"))

    # ── Relations ──────────────────────────────────────────────────────────────
    pi: Mapped["PI | None"] = relationship(back_populates="iterations")
    work_items: Mapped[list["WorkItem"]] = relationship(back_populates="iteration")
