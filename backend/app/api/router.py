"""Routeur principal de l'API : agrège tous les sous-routeurs par domaine.

Les endpoints sont montés sous le préfixe ``/api`` (défini dans ``main.py``).
Seul l'endpoint ``/auth`` est public ; tous les autres nécessitent un JWT
valide fourni via ``get_current_user``.
"""

from fastapi import APIRouter, Depends

from app.api.endpoints import pi, pi_planning, pbr, azdo, settings, team_members, leaves, logs, suivi, auth, train_kpi, admin
from app.services.auth import get_current_user

api_router = APIRouter()

# ── Endpoint public (pas d'authentification requise) ───────────────────────────
api_router.include_router(auth.router,         prefix="/auth",         tags=["Auth"])

# ── Endpoints protégés (JWT requis) ────────────────────────────────────────────
_auth = [Depends(get_current_user)]

api_router.include_router(pi.router,           prefix="/pi",           tags=["PI"],             dependencies=_auth)
api_router.include_router(pi_planning.router,  prefix="/planning",     tags=["PI Planning"],    dependencies=_auth)
api_router.include_router(leaves.router,       prefix="/leaves",       tags=["Congés"],         dependencies=_auth)
api_router.include_router(pbr.router,          prefix="/pbr",          tags=["PBR"],            dependencies=_auth)
api_router.include_router(azdo.router,         prefix="/azdo",         tags=["Azure DevOps"],   dependencies=_auth)
api_router.include_router(settings.router,     prefix="/settings",     tags=["Paramètres"],     dependencies=_auth)
api_router.include_router(team_members.router, prefix="/team-members", tags=["Équipe"],         dependencies=_auth)
api_router.include_router(logs.router,         prefix="/logs",         tags=["Logs"],           dependencies=_auth)
api_router.include_router(suivi.router,        prefix="/suivi",        tags=["Suivi"],          dependencies=_auth)
api_router.include_router(train_kpi.router,    prefix="/train-kpi",    tags=["KPI Train"],      dependencies=_auth)
api_router.include_router(admin.router,        prefix="/admin",        tags=["Admin PI"],       dependencies=_auth)
