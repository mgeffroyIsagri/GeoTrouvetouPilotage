from datetime import datetime
from sqlalchemy import Integer, String, Float, DateTime, Boolean, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class PBRSession(Base):
    __tablename__ = "pbr_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    pi_id: Mapped[int | None] = mapped_column(ForeignKey("pi.id"))

    votes: Mapped[list["PBRVote"]] = relationship(back_populates="session", cascade="all, delete-orphan")


class PBRVote(Base):
    __tablename__ = "pbr_votes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("pbr_sessions.id"), nullable=False)
    team_member_id: Mapped[int] = mapped_column(ForeignKey("team_members.id"), nullable=False)
    work_item_id: Mapped[int] = mapped_column(Integer, nullable=False)  # ID AZDO

    dor_note: Mapped[int | None] = mapped_column(Integer)  # 1-5
    comment: Mapped[str | None] = mapped_column(Text)
    story_points: Mapped[float | None] = mapped_column(Float)
    charge_dev_days: Mapped[float | None] = mapped_column(Float)
    charge_qa_days: Mapped[float | None] = mapped_column(Float)

    # Analyse IA
    ia_dor_note: Mapped[int | None] = mapped_column(Integer)
    ia_comment: Mapped[str | None] = mapped_column(Text)
    ia_analyzed_at: Mapped[datetime | None] = mapped_column(DateTime)

    # Plan d'action si non DOR
    action_plan: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    session: Mapped["PBRSession"] = relationship(back_populates="votes")
    team_member: Mapped["TeamMember"] = relationship(back_populates="pbr_votes")
