from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
from typing import Generator

from app.models.base import Base

DATABASE_URL = "sqlite:///./geotrouvetou.db"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    _run_migrations()


def _run_migrations() -> None:
    """Migrations légères pour les colonnes ajoutées après la création initiale."""
    with engine.connect() as conn:
        # day_offset dans planning_blocks
        try:
            conn.execute(text("ALTER TABLE planning_blocks ADD COLUMN day_offset REAL NOT NULL DEFAULT 0.0"))
            conn.commit()
        except Exception:
            pass  # Colonne déjà présente

        # start_date devient nullable (rien à faire en SQLite, les NULL sont acceptés)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
