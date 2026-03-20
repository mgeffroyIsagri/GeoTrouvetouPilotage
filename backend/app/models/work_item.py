from datetime import datetime
from sqlalchemy import Integer, String, Float, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class WorkItem(Base):
    __tablename__ = "work_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)  # ID AZDO
    type: Mapped[str] = mapped_column(String(50))  # User Story, Bug, Task, Feature, Enabler
    title: Mapped[str] = mapped_column(String(500))
    state: Mapped[str | None] = mapped_column(String(100))
    iteration_path: Mapped[str | None] = mapped_column(String(500))
    assigned_to: Mapped[str | None] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    acceptance_criteria: Mapped[str | None] = mapped_column(Text)
    story_points: Mapped[float | None] = mapped_column(Float)
    original_estimate: Mapped[float | None] = mapped_column(Float)
    completed_work: Mapped[float | None] = mapped_column(Float)
    remaining_work: Mapped[float | None] = mapped_column(Float)
    parent_id: Mapped[int | None] = mapped_column(Integer)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime)
    iteration_id: Mapped[int | None] = mapped_column(ForeignKey("iterations.id"))

    iteration: Mapped["Iteration | None"] = relationship(back_populates="work_items")
    planning_blocks: Mapped[list["PlanningBlock"]] = relationship(back_populates="work_item")
