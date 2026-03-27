"""Service d'authentification : hachage de mot de passe (bcrypt) et JWT."""
import os
import bcrypt
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.database import get_db

bearer_scheme = HTTPBearer()

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24


def _get_jwt_secret() -> str:
    """Retourne le secret utilisé pour signer les JWT.

    Priorité :
    1. Variable d'environnement ``APP_SECRET_KEY``
    2. Clé persistée dans le fichier ``.secret_key`` (via ``crypto._load_or_create_key``)
    """
    secret_env = os.environ.get("APP_SECRET_KEY")
    if secret_env:
        return secret_env
    from app.services.crypto import _load_or_create_key
    return _load_or_create_key().decode()


def hash_password(password: str) -> str:
    """Hache un mot de passe en clair avec bcrypt (sel aléatoire)."""
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    """Vérifie qu'un mot de passe en clair correspond au hash bcrypt stocké."""
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(username: str) -> str:
    """Génère un JWT signé avec une expiration de ``ACCESS_TOKEN_EXPIRE_HOURS`` heures."""
    expire = datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    payload = {"sub": username, "exp": expire}
    return jwt.encode(payload, _get_jwt_secret(), algorithm=ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    """Dépendance FastAPI : valide le JWT et retourne l'utilisateur."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token invalide ou expiré",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(credentials.credentials, _get_jwt_secret(), algorithms=[ALGORITHM])
        username: str | None = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    from app.models.user import AppUser
    user = db.query(AppUser).filter(AppUser.username == username).first()
    if user is None:
        raise credentials_exception
    return user
