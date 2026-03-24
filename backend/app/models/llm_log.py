from datetime import datetime
from sqlalchemy import Integer, String, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class LLMLog(Base):
    __tablename__ = "llm_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    log_type: Mapped[str] = mapped_column(String(30))  # LLM_REQUEST, LLM_RESPONSE, AZDO_FETCH, ERROR, PRODUCTIVITY_REPORT
    work_item_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    session_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pi_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sprint_num: Mapped[int | None] = mapped_column(Integer, nullable=True)
    member_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    summary: Mapped[str | None] = mapped_column(String(300), nullable=True)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
