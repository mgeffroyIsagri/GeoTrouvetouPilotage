"""Endpoints d'authentification : login, profil et changement de mot de passe."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import AppUser
from app.services.auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
)

router = APIRouter()

# ── Schémas Pydantic ───────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    """Corps de la requête de connexion."""

    username: str
    password: str


class LoginResponse(BaseModel):
    """Réponse de connexion contenant le token JWT Bearer."""

    access_token: str
    token_type: str = "bearer"


class ChangePasswordRequest(BaseModel):
    """Corps de la requête de changement de mot de passe."""

    current_password: str
    new_password: str


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    """Authentifie un utilisateur et retourne un token JWT.

    Lève une erreur 401 si les identifiants sont invalides.
    """
    user = db.query(AppUser).filter(AppUser.username == payload.username).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Identifiants incorrects",
        )
    return LoginResponse(access_token=create_access_token(user.username))


@router.get("/me")
def get_me(current_user: AppUser = Depends(get_current_user)):
    """Retourne le nom d'utilisateur de l'utilisateur authentifié."""
    return {"username": current_user.username}


@router.put("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    current_user: AppUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Change le mot de passe de l'utilisateur authentifié.

    Valide le mot de passe actuel avant de procéder au changement.
    Le nouveau mot de passe doit comporter au moins 4 caractères.
    Lève une erreur 400 si le mot de passe actuel est incorrect ou si le
    nouveau mot de passe est trop court.
    """
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mot de passe actuel incorrect",
        )
    if len(payload.new_password) < 4:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Le nouveau mot de passe doit faire au moins 4 caractères",
        )
    current_user.hashed_password = hash_password(payload.new_password)
    db.commit()
    return {"message": "Mot de passe modifié avec succès"}
