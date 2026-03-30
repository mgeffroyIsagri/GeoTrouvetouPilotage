"""Modèles ORM pour les triggers d'automatisation planifiés."""
from datetime import datetime
from sqlalchemy import Integer, String, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base


class Trigger(Base):
    __tablename__ = "triggers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200))
    action_type: Mapped[str] = mapped_column(String(100))  # ex: "azdo_sync_incremental"
    action_params: Mapped[str | None] = mapped_column(Text)  # JSON
    schedule_type: Mapped[str] = mapped_column(String(20))  # "interval" | "daily" | "cron"
    schedule_value: Mapped[str] = mapped_column(String(100))  # ex: "60" (minutes), "08:00", "0 8 * * 1-5"
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_run_status: Mapped[str | None] = mapped_column(String(20))  # "success" | "error" | "running"
    last_run_summary: Mapped[str | None] = mapped_column(String(500))
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    logs: Mapped[list["TriggerLog"]] = relationship(back_populates="trigger", cascade="all, delete-orphan")


class TriggerLog(Base):
    __tablename__ = "trigger_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    trigger_id: Mapped[int] = mapped_column(ForeignKey("triggers.id"))
    ran_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    status: Mapped[str] = mapped_column(String(20))  # "success" | "error"
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    result_summary: Mapped[str | None] = mapped_column(String(500))
    result_detail: Mapped[str | None] = mapped_column(Text)  # JSON

    trigger: Mapped["Trigger"] = relationship(back_populates="logs")
