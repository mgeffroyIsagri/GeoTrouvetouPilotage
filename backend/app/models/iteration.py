from datetime import date
from sqlalchemy import Integer, String, Date, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Iteration(Base):
    __tablename__ = "iterations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    azdo_id: Mapped[str | None] = mapped_column(String(100), unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    path: Mapped[str | None] = mapped_column(String(500))
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    sprint_number: Mapped[int | None] = mapped_column(Integer)  # 1-4 dans le PI
    pi_id: Mapped[int | None] = mapped_column(ForeignKey("pi.id"))

    pi: Mapped["PI | None"] = relationship(back_populates="iterations")
    work_items: Mapped[list["WorkItem"]] = relationship(back_populates="iteration")
