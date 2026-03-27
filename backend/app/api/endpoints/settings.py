"""Endpoints de gestion des paramètres de l'application (clé/valeur).

Les clés sensibles (PAT AZDO, clé API LLM) sont chiffrées avant stockage et
retournées masquées (``***``) côté client pour éviter toute fuite dans les
réponses API. L'envoi de la valeur ``***`` en PUT est ignoré pour préserver
la valeur existante.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models.app_settings import AppSettings, SETTING_KEYS
from app.services.auth import get_current_user
from app.services.crypto import encrypt_value, SENSITIVE_KEYS

router = APIRouter()

# Masque affiché côté client à la place des valeurs sensibles
_MASK = "***"


# ── Schémas Pydantic ───────────────────────────────────────────────────────────

class SettingUpsert(BaseModel):
    """Corps d'une création ou mise à jour de paramètre."""

    key: str
    value: str


class SettingResponse(BaseModel):
    """Représentation d'un paramètre retourné par l'API."""

    key: str
    value: str | None
    description: str | None

    class Config:
        from_attributes = True


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[SettingResponse])
def get_all_settings(
    db: Session = Depends(get_db),
    _current_user=Depends(get_current_user),
):
    """Liste tous les paramètres de l'application.

    Initialise les clés manquantes avec une valeur nulle avant de retourner
    la liste complète. Les valeurs des clés sensibles sont remplacées par
    ``***`` dans la réponse.
    """
    # Initialise les clés prédéfinies manquantes avec une valeur nulle
    existing = {s.key for s in db.query(AppSettings).all()}
    for key, desc in SETTING_KEYS.items():
        if key not in existing:
            db.add(AppSettings(key=key, value=None, description=desc))
    db.commit()

    result = []
    for s in db.query(AppSettings).order_by(AppSettings.key).all():
        # Masquer les valeurs sensibles : le frontend n'a pas besoin du contenu réel
        if s.key in SENSITIVE_KEYS and s.value:
            result.append(SettingResponse(key=s.key, value=_MASK, description=s.description))
        else:
            result.append(SettingResponse(key=s.key, value=s.value, description=s.description))
    return result


@router.put("/{key}", response_model=SettingResponse)
def upsert_setting(
    key: str,
    payload: SettingUpsert,
    db: Session = Depends(get_db),
    _current_user=Depends(get_current_user),
):
    """Crée ou met à jour un paramètre identifié par sa clé.

    Si la valeur reçue est le masque (``***``) pour une clé sensible,
    la valeur existante est conservée sans modification. Sinon, la valeur
    est chiffrée si la clé est sensible, puis persistée. La réponse retourne
    toujours ``***`` pour les clés sensibles.
    """
    # Si la valeur est le masque, ne pas écraser la valeur existante
    if key in SENSITIVE_KEYS and payload.value == _MASK:
        setting = db.query(AppSettings).filter(AppSettings.key == key).first()
        if setting:
            return SettingResponse(key=setting.key, value=_MASK, description=setting.description)
        return SettingResponse(key=key, value=None, description=SETTING_KEYS.get(key))

    # Chiffrer les clés sensibles avant stockage
    stored_value = encrypt_value(payload.value) if key in SENSITIVE_KEYS and payload.value else payload.value

    setting = db.query(AppSettings).filter(AppSettings.key == key).first()
    if setting:
        setting.value = stored_value
    else:
        setting = AppSettings(key=key, value=stored_value)
        db.add(setting)
    db.commit()
    db.refresh(setting)

    # Retourner masqué pour les clés sensibles
    if key in SENSITIVE_KEYS and setting.value:
        return SettingResponse(key=setting.key, value=_MASK, description=setting.description)
    return setting


@router.get("/{key}", response_model=SettingResponse)
def get_setting(
    key: str,
    db: Session = Depends(get_db),
    _current_user=Depends(get_current_user),
):
    """Retourne un paramètre par sa clé.

    Si la clé n'existe pas en base, retourne un objet avec ``value=None``.
    Les valeurs sensibles sont retournées masquées (``***``).
    """
    setting = db.query(AppSettings).filter(AppSettings.key == key).first()
    if not setting:
        return SettingResponse(key=key, value=None, description=SETTING_KEYS.get(key))
    if key in SENSITIVE_KEYS and setting.value:
        return SettingResponse(key=key, value=_MASK, description=setting.description)
    return setting
