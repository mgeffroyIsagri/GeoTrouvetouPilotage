from fastapi import APIRouter

from app.api.endpoints import pi, pi_planning, pbr, azdo, settings, team_members, leaves, logs, suivi

api_router = APIRouter()

api_router.include_router(pi.router,           prefix="/pi",           tags=["PI"])
api_router.include_router(pi_planning.router,  prefix="/planning",     tags=["PI Planning"])
api_router.include_router(leaves.router,       prefix="/leaves",       tags=["Congés"])
api_router.include_router(pbr.router,          prefix="/pbr",          tags=["PBR"])
api_router.include_router(azdo.router,         prefix="/azdo",         tags=["Azure DevOps"])
api_router.include_router(settings.router,     prefix="/settings",     tags=["Paramètres"])
api_router.include_router(team_members.router, prefix="/team-members", tags=["Équipe"])
api_router.include_router(logs.router,         prefix="/logs",         tags=["Logs"])
api_router.include_router(suivi.router,        prefix="/suivi",        tags=["Suivi"])
