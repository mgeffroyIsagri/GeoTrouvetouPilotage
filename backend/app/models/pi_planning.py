from datetime import date
from sqlalchemy import Integer, String, Float, Date, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

# Catégories de briques
CATEGORIES = [
    "stories_dev",
    "stories_qa",
    "bugs_maintenance",
    "imprevus",
    "agility",
    "reunions",
    "psm",
    "montee_competence",
    "conges",
]


class PlanningBlock(Base):
    """Brique de capacité sur le calendrier PI Planning."""

    __tablename__ = "planning_blocks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pi_id: Mapped[int] = mapped_column(ForeignKey("pi.id"), nullable=False)
    team_member_id: Mapped[int] = mapped_column(ForeignKey("team_members.id"), nullable=False)
    sprint_number: Mapped[int] = mapped_column(Integer, nullable=False)  # 1-4

    # Positionnement : day_offset = jours ouvrés depuis le vendredi de début du sprint
    # (ex: 0.0 = ven, 0.5 = ven après-midi, 1.0 = lun, 1.5 = lun après-midi...)
    day_offset: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    start_date: Mapped[date | None] = mapped_column(Date)  # date calendaire (indicatif)
    duration_days: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)

    category: Mapped[str] = mapped_column(String(50), nullable=False)
    # Couche visuelle : 1 = base, 2 = stories (superposées)
    layer: Mapped[int] = mapped_column(Integer, default=1)
    # Bloc généré automatiquement vs posé manuellement
    is_auto_generated: Mapped[bool] = mapped_column(Boolean, default=True)
    # Verrou : si True, le bloc ne peut pas être supprimé (même via reset)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)

    # Lien optionnel vers un work item AZDO (pour les stories)
    work_item_id: Mapped[int | None] = mapped_column(ForeignKey("work_items.id"))

    # Groupe de briques (pour les stories splittées sur plusieurs écarts/sprints)
    group_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    pi: Mapped["PI"] = relationship(back_populates="planning_blocks")
    team_member: Mapped["TeamMember"] = relationship(back_populates="planning_blocks")
    work_item: Mapped["WorkItem | None"] = relationship(back_populates="planning_blocks")
