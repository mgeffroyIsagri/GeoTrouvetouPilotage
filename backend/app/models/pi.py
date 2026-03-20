from datetime import date
from sqlalchemy import Integer, String, Date
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class PI(Base):
    __tablename__ = "pi"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    azdo_iteration_path: Mapped[str | None] = mapped_column(String(500))
    is_active: Mapped[bool] = mapped_column(default=False)

    iterations: Mapped[list["Iteration"]] = relationship(back_populates="pi", cascade="all, delete-orphan")
    planning_blocks: Mapped[list["PlanningBlock"]] = relationship(back_populates="pi", cascade="all, delete-orphan")
