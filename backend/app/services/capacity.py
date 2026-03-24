"""Service de génération automatique des blocs de capacité PI Planning."""

import json
from datetime import date, timedelta
from sqlalchemy.orm import Session

from app.models.pi import PI
from app.models.iteration import Iteration
from app.models.team_member import TeamMember
from app.models.pi_planning import PlanningBlock
from app.models.leave import Leave
from app.models.app_settings import AppSettings

# ── Matrices par défaut (jours par catégorie pour N jours travaillés dans la semaine) ──

DEV_MATRIX_DEFAULT: dict[int, dict[str, float]] = {
    5: {"agility": 0.5, "reunions": 0.5, "bugs_maintenance": 0.5, "imprevus": 0.25, "montee_competence": 0.25},
    4: {"agility": 0.5, "reunions": 0.5, "bugs_maintenance": 0.5, "imprevus": 0.0,  "montee_competence": 0.0},
    3: {"agility": 0.5, "reunions": 0.25, "bugs_maintenance": 0.25, "imprevus": 0.0, "montee_competence": 0.0},
    2: {"agility": 0.25, "reunions": 0.25, "bugs_maintenance": 0.0, "imprevus": 0.0, "montee_competence": 0.0},
    1: {"agility": 0.25, "reunions": 0.0,  "bugs_maintenance": 0.0, "imprevus": 0.0, "montee_competence": 0.0},
    0: {},
}

# Matrices Klaxoon — colonne "Stories" exclue (laissée libre pour les story blocks layer 2)
QA_MATRIX_DEFAULT: dict[int, dict[str, float]] = {
    5: {"agility": 0.50, "reunions": 0.50, "bugs_maintenance": 0.75, "imprevus": 1.25, "montee_competence": 0.50},
    4: {"agility": 0.25, "reunions": 0.25, "bugs_maintenance": 0.50, "imprevus": 1.00, "montee_competence": 0.50},
    3: {"agility": 0.25, "reunions": 0.25, "bugs_maintenance": 0.50, "imprevus": 0.75, "montee_competence": 0.25},
    2: {"agility": 0.25, "reunions": 0.25, "bugs_maintenance": 0.25, "imprevus": 0.50, "montee_competence": 0.25},
    1: {"agility": 0.00, "reunions": 0.00, "bugs_maintenance": 0.00, "imprevus": 0.25, "montee_competence": 0.25},
    0: {},
}

PSM_MATRIX_DEFAULT: dict[int, dict[str, float]] = {
    5: {"psm": 1.75, "reunions": 0.75, "agility": 0.50, "bugs_maintenance": 0.25, "montee_competence": 0.50, "imprevus": 0.50},
    4: {"psm": 1.50, "reunions": 0.50, "agility": 0.25, "bugs_maintenance": 0.25, "montee_competence": 0.50, "imprevus": 0.50},
    3: {"psm": 1.00, "reunions": 0.50, "agility": 0.25, "bugs_maintenance": 0.25, "montee_competence": 0.25, "imprevus": 0.25},
    2: {"psm": 0.75, "reunions": 0.25, "agility": 0.25, "bugs_maintenance": 0.00, "montee_competence": 0.25, "imprevus": 0.25},
    1: {"psm": 0.75, "reunions": 0.00, "agility": 0.00, "bugs_maintenance": 0.00, "montee_competence": 0.25, "imprevus": 0.00},
    0: {},
}

# Nombre de semaines par sprint
SPRINT_WEEKS = {1: 3, 2: 3, 3: 4, 4: 3}

# Ordre des catégories pour le placement séquentiel
CATEGORY_ORDER = ["agility", "reunions", "bugs_maintenance", "imprevus", "montee_competence", "psm"]


def _get_matrix(profile: str, db: Session) -> dict[int, dict[str, float]]:
    """Charge la matrice depuis les paramètres ou retourne la matrice par défaut."""
    key_map = {"Dev": "capacity_matrix_dev", "QA": "capacity_matrix_qa", "PSM": "capacity_matrix_psm"}
    setting_key = key_map.get(profile)
    if setting_key:
        row = db.query(AppSettings).filter(AppSettings.key == setting_key).first()
        if row and row.value:
            try:
                raw = json.loads(row.value)
                return {int(k): v for k, v in raw.items()}
            except Exception:
                pass
    defaults = {"Dev": DEV_MATRIX_DEFAULT, "QA": QA_MATRIX_DEFAULT, "PSM": PSM_MATRIX_DEFAULT}
    return defaults.get(profile, DEV_MATRIX_DEFAULT)


def generate_pi_planning(pi_id: int, db: Session) -> None:
    """Supprime les blocs auto-générés existants et régénère le calendrier capacitaire."""
    db.query(PlanningBlock).filter(
        PlanningBlock.pi_id == pi_id,
        PlanningBlock.is_auto_generated == True,
    ).delete()
    db.flush()

    pi = db.query(PI).filter(PI.id == pi_id).first()
    if not pi:
        raise ValueError(f"PI {pi_id} introuvable")

    sprints = (
        db.query(Iteration)
        .filter(Iteration.pi_id == pi_id)
        .order_by(Iteration.sprint_number)
        .all()
    )
    if not sprints:
        raise ValueError(f"Aucune itération trouvée pour le PI {pi_id}. Créez d'abord les sprints.")

    PROFILES_NO_PLANNING = {"Squad Lead", "Automate"}
    members = db.query(TeamMember).filter(TeamMember.is_active == True).all()

    for sprint in sprints:
        sprint_num = sprint.sprint_number
        n_weeks = SPRINT_WEEKS.get(sprint_num, 3)
        total_working_days = n_weeks * 5

        for member in members:
            if member.profile in PROFILES_NO_PLANNING:
                continue
            matrix = _get_matrix(member.profile, db)

            # Congés de ce membre sur ce sprint
            leaves = db.query(Leave).filter(
                Leave.pi_id == pi_id,
                Leave.team_member_id == member.id,
                Leave.sprint_number == sprint_num,
            ).all()

            # Ensemble des demi-journées de congé (arrondi à 0.5)
            leave_half_days: set[float] = set()
            for leave in leaves:
                off = leave.day_offset
                while off < leave.day_offset + leave.duration_days - 0.01:
                    leave_half_days.add(round(off * 2) / 2)
                    off += 0.5

            # Segments calendaires lundi-vendredi.
            # Le sprint commence un vendredi (offset 0), donc :
            #   segment 0 : vendredi seul      → [0, 1)
            #   segment 1 : lundi-vendredi     → [1, 6)
            #   segment 2 : lundi-vendredi     → [6, 11)  ...
            segments: list[tuple[float, float]] = [(0.0, 1.0)]
            seg_start = 1.0
            while seg_start < total_working_days:
                segments.append((seg_start, min(seg_start + 5.0, float(total_working_days))))
                seg_start += 5.0

            total_fixed = 0.0
            blocks_data: list[dict] = []

            for seg_start, seg_end in segments:
                seg_size = seg_end - seg_start  # nb nominal de jours dans ce segment

                # Congés dans ce segment
                leaves_this_seg = sum(
                    1 for h in leave_half_days
                    if seg_start <= h < seg_end
                ) * 0.5
                available_days = seg_size - leaves_this_seg

                n_available = max(0, min(5, int(round(available_days))))
                week_matrix = matrix.get(n_available, {})

                cursor = seg_start
                for cat in CATEGORY_ORDER:
                    duration = week_matrix.get(cat, 0.0)
                    if duration <= 0:
                        continue
                    # Avancer le curseur en sautant les congés
                    while round(cursor * 2) / 2 in leave_half_days and cursor < seg_end:
                        cursor += 0.5

                    if cursor >= seg_end:
                        break

                    blocks_data.append({
                        "pi_id": pi_id,
                        "team_member_id": member.id,
                        "sprint_number": sprint_num,
                        "day_offset": round(cursor, 2),
                        "duration_days": duration,
                        "category": cat,
                        "layer": 1,
                        "is_auto_generated": True,
                        "start_date": sprint.start_date,
                    })
                    cursor += duration
                    total_fixed += duration

            for data in blocks_data:
                db.add(PlanningBlock(**data))

    db.commit()
