"""Modèles ORM pour le PI Planning : briques de capacité sur le calendrier."""

from datetime import date
from sqlalchemy import Integer, String, Float, Date, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

# ── Constantes ─────────────────────────────────────────────────────────────────

# Catégories de briques reconnues par le système de capacité
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


# ── Modèle ─────────────────────────────────────────────────────────────────────

class PlanningBlock(Base):
    """Brique de capacité sur le calendrier PI Planning.

    Chaque brique appartient à un membre de l'équipe pour un sprint donné.
    Elle est positionnée par ``day_offset`` (jours ouvrés depuis le vendredi
    de début du sprint, par pas de 0,5 journée) et a une durée en jours.

    Deux couches coexistent visuellement :
    - Layer 1 : briques fixes auto-générées (agility, réunions, bugs…)
    - Layer 2 : briques stories superposées, ajoutées manuellement

    Les briques Layer 1 sont recréées par ``capacity.py`` lors de la
    génération. Les briques Layer 2 (stories) ne sont jamais auto-générées.
    """

    __tablename__ = "planning_blocks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pi_id: Mapped[int] = mapped_column(ForeignKey("pi.id"), nullable=False)
    team_member_id: Mapped[int] = mapped_column(ForeignKey("team_members.id"), nullable=False)
    # Numéro de sprint dans le PI (1 à 4)
    sprint_number: Mapped[int] = mapped_column(Integer, nullable=False)

    # ── Positionnement ─────────────────────────────────────────────────────────
    # day_offset = jours ouvrés depuis le vendredi de début du sprint
    # (ex: 0.0 = ven, 0.5 = ven après-midi, 1.0 = lun, 1.5 = lun après-midi…)
    day_offset: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    start_date: Mapped[date | None] = mapped_column(Date)  # date calendaire (indicatif)
    duration_days: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)

    # ── Métadonnées de la brique ───────────────────────────────────────────────
    category: Mapped[str] = mapped_column(String(50), nullable=False)
    # Couche visuelle : 1 = base (non déplaçable), 2 = stories (superposées)
    layer: Mapped[int] = mapped_column(Integer, default=1)
    # Bloc généré automatiquement (True) vs posé manuellement (False)
    is_auto_generated: Mapped[bool] = mapped_column(Boolean, default=True)
    # Verrou : si True, le bloc ne peut pas être supprimé (même via reset)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)

    # ── Liens optionnels ───────────────────────────────────────────────────────
    # Lien vers un work item AZDO (pour les stories Layer 2)
    work_item_id: Mapped[int | None] = mapped_column(ForeignKey("work_items.id"))
    # Groupe de briques (pour les stories splittées sur plusieurs sprints)
    group_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Commentaire libre sur la brique (stories uniquement)
    comment: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    # ── Relations ──────────────────────────────────────────────────────────────
    pi: Mapped["PI"] = relationship(back_populates="planning_blocks")
    team_member: Mapped["TeamMember"] = relationship(back_populates="planning_blocks")
    work_item: Mapped["WorkItem | None"] = relationship(back_populates="planning_blocks")
