from sqlalchemy import Integer, String, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class TeamMember(Base):
    __tablename__ = "team_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    azdo_id: Mapped[str | None] = mapped_column(String(200), unique=True)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    unique_name: Mapped[str | None] = mapped_column(String(200))
    # Profil : Dev, QA, PSM
    profile: Mapped[str] = mapped_column(String(20), nullable=False, default="Dev")
    is_active: Mapped[bool] = mapped_column(default=True)

    planning_blocks: Mapped[list["PlanningBlock"]] = relationship(back_populates="team_member")
    pbr_votes: Mapped[list["PBRVote"]] = relationship(back_populates="team_member")
