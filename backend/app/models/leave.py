"""Modèle ORM pour les congés et absences des collaborateurs."""

from sqlalchemy import Integer, String, Float, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Leave(Base):
    """Congé ou absence d'un collaborateur sur un sprint donné.

    La position dans le sprint est exprimée en ``day_offset`` (jours ouvrés
    depuis le vendredi de début, par pas de 0,5 journée), identique à la
    convention utilisée par ``PlanningBlock``. Le service de capacité
    (``capacity.py``) tient compte des congés par semaine pour sélectionner
    la bonne ligne de matrice.

    Exemples de labels : "CP", "RTT", "Maladie", "Férié".
    """

    __tablename__ = "leaves"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pi_id: Mapped[int] = mapped_column(ForeignKey("pi.id"), nullable=False)
    team_member_id: Mapped[int] = mapped_column(ForeignKey("team_members.id"), nullable=False)
    sprint_number: Mapped[int] = mapped_column(Integer, nullable=False)
    # Position dans le sprint (jours ouvrés depuis le vendredi de début)
    day_offset: Mapped[float] = mapped_column(Float, nullable=False)
    duration_days: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    # Type d'absence : CP, RTT, Maladie, Férié…
    label: Mapped[str | None] = mapped_column(String(50))

    # ── Relations ──────────────────────────────────────────────────────────────
    team_member: Mapped["TeamMember"] = relationship()
