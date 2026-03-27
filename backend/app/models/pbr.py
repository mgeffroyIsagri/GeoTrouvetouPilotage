"""Modèles ORM pour les sessions PBR (Product Backlog Refinement)."""

from datetime import datetime
from sqlalchemy import Integer, String, Float, DateTime, Boolean, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


# ── Sessions ───────────────────────────────────────────────────────────────────

class PBRSession(Base):
    """Session de refinement collectif du backlog.

    Une session regroupe un ensemble d'items (sujets à affiner) et les votes
    associés des participants. Une session peut être dupliquée via
    ``POST /pbr/sessions/{id}/copy`` — les items sont copiés sans leurs votes.

    ``excluded_member_ids`` est une liste JSON d'identifiants de membres
    exclus du vote pour cette session (ex: ``[3, 7]``).
    """

    __tablename__ = "pbr_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    pi_id: Mapped[int | None] = mapped_column(ForeignKey("pi.id"))
    # Liste JSON d'int : membres exclus du vote (ex: "[3, 7]")
    excluded_member_ids: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Relations ──────────────────────────────────────────────────────────────
    items: Mapped[list["PBRItem"]] = relationship(back_populates="session", cascade="all, delete-orphan")
    votes: Mapped[list["PBRVote"]] = relationship(back_populates="session", cascade="all, delete-orphan")


# ── Items ──────────────────────────────────────────────────────────────────────

class PBRItem(Base):
    """Sujet (work item AZDO) ajouté à une session PBR.

    Un item référence un work item AZDO par son identifiant numérique. Les
    parents (``depth=0``) correspondent à des Features ou Enablers ; les
    enfants (``depth=1``) correspondent à des stories enfants récupérées via
    ``POST /pbr/items/{id}/sync``.

    L'analyse IA (DoR) est déclenchée via ``POST /pbr/items/{id}/analyze``
    et stocke la note (``ia_dor_note``), le commentaire (``ia_comment``) et
    l'horodatage (``ia_analyzed_at``).

    Un item déprioritisé (``is_deprioritized=True``) est visuellement grisé ;
    ses enfants héritent de cet état côté frontend.
    """

    __tablename__ = "pbr_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("pbr_sessions.id"), nullable=False)
    # Identifiant numérique AZDO du work item (non FK pour rester découplé)
    work_item_id: Mapped[int] = mapped_column(Integer, nullable=False)
    # Plan d'action libre saisi lors du refinement
    action_plan: Mapped[str | None] = mapped_column(Text)
    # Note DoR attribuée par le LLM (0-10)
    ia_dor_note: Mapped[int | None] = mapped_column(Integer)
    # Commentaire détaillé généré par le LLM
    ia_comment: Mapped[str | None] = mapped_column(Text)
    ia_analyzed_at: Mapped[datetime | None] = mapped_column(DateTime)
    # Responsable du refinement pour cet item
    refinement_owner_id: Mapped[int | None] = mapped_column(ForeignKey("team_members.id"), nullable=True)
    # Si True, l'item est déprioritisé (archivé visuellement)
    is_deprioritized: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # ── Relations ──────────────────────────────────────────────────────────────
    session: Mapped["PBRSession"] = relationship(back_populates="items")


# ── Votes ──────────────────────────────────────────────────────────────────────

class PBRVote(Base):
    """Vote d'un participant sur un sujet d'une session PBR.

    Chaque vote porte sur la conformité DoR (oui/non), un commentaire libre,
    une estimation en story points et des charges de développement/QA en
    jours. Un participant peut réviser son vote ; c'est le frontend qui gère
    l'unicité par ``(session_id, team_member_id, work_item_id)``.
    """

    __tablename__ = "pbr_votes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("pbr_sessions.id"), nullable=False)
    team_member_id: Mapped[int] = mapped_column(ForeignKey("team_members.id"), nullable=False)
    # Identifiant numérique AZDO du work item voté
    work_item_id: Mapped[int] = mapped_column(Integer, nullable=False)

    # Conformité DoR : True = OK, False = NOK, None = pas encore voté
    dor_compliant: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    comment: Mapped[str | None] = mapped_column(Text)
    story_points: Mapped[float | None] = mapped_column(Float)
    charge_dev_days: Mapped[float | None] = mapped_column(Float)
    charge_qa_days: Mapped[float | None] = mapped_column(Float)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # ── Relations ──────────────────────────────────────────────────────────────
    session: Mapped["PBRSession"] = relationship(back_populates="votes")
    team_member: Mapped["TeamMember"] = relationship(back_populates="pbr_votes")
