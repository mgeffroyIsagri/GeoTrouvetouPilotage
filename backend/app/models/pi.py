"""Modèle ORM pour les Programme Increments (PI)."""

from datetime import date
from sqlalchemy import Integer, String, Date, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class PI(Base):
    """Programme Increment : conteneur principal regroupant 4 sprints.

    Un PI démarre obligatoirement un vendredi et contient 4 itérations
    auto-créées à la création (3w, 3w, 4w, 3w IP).
    Un seul PI peut être actif à la fois (``is_active=True``).
    """

    __tablename__ = "pi"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    # Chemin d'itération Azure DevOps associé (ex: "MonProjet\\PI 2025-1")
    azdo_iteration_path: Mapped[str | None] = mapped_column(String(500))
    is_active: Mapped[bool] = mapped_column(default=False)
    # Quand verrouillé, le PI planning est en lecture seule et le panel admin est accessible
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)

    # ── Relations ──────────────────────────────────────────────────────────────
    iterations: Mapped[list["Iteration"]] = relationship(back_populates="pi", cascade="all, delete-orphan")
    planning_blocks: Mapped[list["PlanningBlock"]] = relationship(back_populates="pi", cascade="all, delete-orphan")
