"""Modèle ORM pour les membres de l'équipe GeoTrouvetou."""

from sqlalchemy import Integer, String, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class TeamMember(Base):
    """Collaborateur de l'équipe participant au PI Planning et aux PBR.

    Le ``profile`` détermine la matrice de capacité utilisée lors de la
    génération des blocs Layer 1. Les profils ``Squad Lead`` et ``Automate``
    sont ignorés par le service de capacité.

    Valeurs de ``profile`` autorisées : ``Dev``, ``QA``, ``PSM``,
    ``Squad Lead``, ``Automate``.

    La suppression est logique (``is_active = False``) pour préserver
    l'historique des votes et des blocs associés.
    """

    __tablename__ = "team_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Identifiant unique Azure DevOps (GUID), nullable si créé manuellement
    azdo_id: Mapped[str | None] = mapped_column(String(200), unique=True)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    # Adresse email ou UPN AZDO (ex: prenom.nom@isagri.fr)
    unique_name: Mapped[str | None] = mapped_column(String(200))
    # Profil : Dev, QA, PSM, Squad Lead, Automate
    profile: Mapped[str] = mapped_column(String(20), nullable=False, default="Dev")
    # Suppression logique : False = archivé, ne plus afficher ni utiliser
    is_active: Mapped[bool] = mapped_column(default=True)

    # ── Relations ──────────────────────────────────────────────────────────────
    planning_blocks: Mapped[list["PlanningBlock"]] = relationship(back_populates="team_member")
    pbr_votes: Mapped[list["PBRVote"]] = relationship(back_populates="team_member")
