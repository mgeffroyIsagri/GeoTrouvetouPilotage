"""
Initialisation de la base de données SQLite et migrations incrémentales.

Ce module expose :
- ``engine``        : moteur SQLAlchemy (SQLite local ou /home sur Azure)
- ``SessionLocal``  : fabrique de sessions ORM
- ``init_db()``     : crée toutes les tables et applique les migrations
- ``get_db()``      : générateur de session pour l'injection de dépendances FastAPI
"""

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
from typing import Generator

from app.models.base import Base
from app.models.user import AppUser  # noqa: F401 — garantit la création de la table app_users
from app.models.train_kpi import TrainTeam, TrainKpiEntry  # noqa: F401 — garantit la création des tables train_kpi

# ── Résolution du chemin de la base de données ────────────────────────────────
# Sur Azure App Service, WEBSITE_SITE_NAME est défini automatiquement.
# /home est un volume persistant sur Azure → la BDD survit aux redémarrages.
import os as _os
if _os.environ.get("WEBSITE_SITE_NAME"):
    DATABASE_URL = "sqlite:////home/geotrouvetou.db"
else:
    DATABASE_URL = "sqlite:///./geotrouvetou.db"

# ── Moteur et session ─────────────────────────────────────────────────────────
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db() -> None:
    """Crée toutes les tables ORM (si inexistantes) puis applique les migrations."""
    Base.metadata.create_all(bind=engine)
    _run_migrations()


def _run_migrations() -> None:
    """Migrations légères pour les colonnes ajoutées après la création initiale.

    Chaque instruction ``ALTER TABLE`` est enveloppée dans un try/except pour
    rester idempotente : SQLite lève une erreur si la colonne existe déjà.
    """
    with engine.connect() as conn:
        # day_offset dans planning_blocks
        try:
            conn.execute(text("ALTER TABLE planning_blocks ADD COLUMN day_offset REAL NOT NULL DEFAULT 0.0"))
            conn.commit()
        except Exception:
            pass  # Colonne déjà présente

        # is_locked dans planning_blocks
        try:
            conn.execute(text("ALTER TABLE planning_blocks ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0"))
            conn.commit()
        except Exception:
            pass

        # start_date devient nullable (rien à faire en SQLite, les NULL sont acceptés)

        # group_id dans planning_blocks
        try:
            conn.execute(text("ALTER TABLE planning_blocks ADD COLUMN group_id INTEGER"))
            conn.commit()
        except Exception:
            pass

        # comment dans planning_blocks
        try:
            conn.execute(text("ALTER TABLE planning_blocks ADD COLUMN comment TEXT"))
            conn.commit()
        except Exception:
            pass

        # excluded_member_ids dans pbr_sessions
        try:
            conn.execute(text("ALTER TABLE pbr_sessions ADD COLUMN excluded_member_ids TEXT"))
            conn.commit()
        except Exception:
            pass

        # dor_compliant dans pbr_votes (remplace dor_note 1-5)
        try:
            conn.execute(text("ALTER TABLE pbr_votes ADD COLUMN dor_compliant INTEGER"))
            conn.commit()
        except Exception:
            pass

        # refinement_owner_id dans pbr_items
        try:
            conn.execute(text("ALTER TABLE pbr_items ADD COLUMN refinement_owner_id INTEGER"))
            conn.commit()
        except Exception:
            pass

        # is_deprioritized dans pbr_items
        try:
            conn.execute(text("ALTER TABLE pbr_items ADD COLUMN is_deprioritized INTEGER NOT NULL DEFAULT 0"))
            conn.commit()
        except Exception:
            pass

        # pi_id, sprint_num, member_id dans llm_log (pour rapports productivité)
        for col in ["pi_id INTEGER", "sprint_num INTEGER", "member_id INTEGER"]:
            try:
                conn.execute(text(f"ALTER TABLE llm_log ADD COLUMN {col}"))
                conn.commit()
            except Exception:
                pass

        # is_locked sur pi
        try:
            conn.execute(text("ALTER TABLE pi ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0"))
            conn.commit()
        except Exception:
            pass

        # business_value + effort sur work_items (Features/Enablers)
        try:
            conn.execute(text("ALTER TABLE work_items ADD COLUMN business_value REAL"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE work_items ADD COLUMN effort REAL"))
            conn.commit()
        except Exception:
            pass

        # Migration dor_note → dor_compliant (note >= 4 = Oui, < 4 = Non)
        try:
            conn.execute(text(
                "UPDATE pbr_votes SET dor_compliant = CASE WHEN dor_note >= 4 THEN 1 ELSE 0 END "
                "WHERE dor_compliant IS NULL AND dor_note IS NOT NULL"
            ))
            conn.commit()
        except Exception:
            pass

        # Mise à jour des matrices de capacité QA et PSM vers les valeurs Klaxoon
        try:
            import json as _json
            qa_matrix = _json.dumps({
                "5": {"agility": 0.50, "reunions": 0.50, "bugs_maintenance": 0.75, "imprevus": 1.25, "montee_competence": 0.50},
                "4": {"agility": 0.25, "reunions": 0.25, "bugs_maintenance": 0.50, "imprevus": 1.00, "montee_competence": 0.50},
                "3": {"agility": 0.25, "reunions": 0.25, "bugs_maintenance": 0.50, "imprevus": 0.75, "montee_competence": 0.25},
                "2": {"agility": 0.25, "reunions": 0.25, "bugs_maintenance": 0.25, "imprevus": 0.50, "montee_competence": 0.25},
                "1": {"agility": 0.00, "reunions": 0.00, "bugs_maintenance": 0.00, "imprevus": 0.25, "montee_competence": 0.25},
                "0": {},
            })
            psm_matrix = _json.dumps({
                "5": {"psm": 1.75, "reunions": 0.75, "agility": 0.50, "bugs_maintenance": 0.25, "montee_competence": 0.50, "imprevus": 0.50},
                "4": {"psm": 1.50, "reunions": 0.50, "agility": 0.25, "bugs_maintenance": 0.25, "montee_competence": 0.50, "imprevus": 0.50},
                "3": {"psm": 1.00, "reunions": 0.50, "agility": 0.25, "bugs_maintenance": 0.25, "montee_competence": 0.25, "imprevus": 0.25},
                "2": {"psm": 0.75, "reunions": 0.25, "agility": 0.25, "bugs_maintenance": 0.00, "montee_competence": 0.25, "imprevus": 0.25},
                "1": {"psm": 0.75, "reunions": 0.00, "agility": 0.00, "bugs_maintenance": 0.00, "montee_competence": 0.25, "imprevus": 0.00},
                "0": {},
            })
            conn.execute(text("UPDATE app_settings SET value = :v WHERE key = 'capacity_matrix_qa'"), {"v": qa_matrix})
            conn.execute(text("UPDATE app_settings SET value = :v WHERE key = 'capacity_matrix_psm'"), {"v": psm_matrix})
            conn.commit()
        except Exception:
            pass

        # Tables triggers et trigger_logs (automatisations planifiées)
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS triggers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name VARCHAR(200) NOT NULL,
                    action_type VARCHAR(100) NOT NULL,
                    action_params TEXT,
                    schedule_type VARCHAR(20) NOT NULL,
                    schedule_value VARCHAR(100) NOT NULL,
                    enabled BOOLEAN DEFAULT 1,
                    last_run_at DATETIME,
                    last_run_status VARCHAR(20),
                    last_run_summary VARCHAR(500),
                    next_run_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.commit()
        except Exception:
            pass

        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS trigger_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    trigger_id INTEGER REFERENCES triggers(id),
                    ran_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    status VARCHAR(20) NOT NULL,
                    duration_ms INTEGER,
                    result_summary VARCHAR(500),
                    result_detail TEXT
                )
            """))
            conn.commit()
        except Exception:
            pass

        # Chiffrement des secrets existants en clair (migration one-shot)
        try:
            from app.services.crypto import encrypt_value, is_encrypted, SENSITIVE_KEYS
            for _key in SENSITIVE_KEYS:
                row = conn.execute(
                    text("SELECT value FROM app_settings WHERE key = :k"), {"k": _key}
                ).fetchone()
                if row and row[0] and not is_encrypted(row[0]):
                    conn.execute(
                        text("UPDATE app_settings SET value = :v WHERE key = :k"),
                        {"v": encrypt_value(row[0]), "k": _key},
                    )
            conn.commit()
        except Exception:
            pass

        # Création de l'utilisateur admin par défaut (si aucun utilisateur n'existe)
        try:
            import bcrypt as _bcrypt_lib
            count = conn.execute(text("SELECT COUNT(*) FROM app_users")).fetchone()[0]
            if count == 0:
                _hashed = _bcrypt_lib.hashpw(b"admin", _bcrypt_lib.gensalt()).decode()
                conn.execute(
                    text("INSERT INTO app_users (username, hashed_password) VALUES (:u, :h)"),
                    {"u": "admin", "h": _hashed},
                )
                conn.commit()
        except Exception:
            pass


def get_db() -> Generator[Session, None, None]:
    """Générateur de session SQLAlchemy pour l'injection de dépendances FastAPI.

    Usage::

        @router.get("/example")
        def my_endpoint(db: Session = Depends(get_db)):
            ...
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
