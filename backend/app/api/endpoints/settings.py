from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models.app_settings import AppSettings, SETTING_KEYS

router = APIRouter()


class SettingUpsert(BaseModel):
    key: str
    value: str


class SettingResponse(BaseModel):
    key: str
    value: str | None
    description: str | None

    class Config:
        from_attributes = True


@router.get("/", response_model=list[SettingResponse])
def get_all_settings(db: Session = Depends(get_db)):
    # Initialise les clés manquantes
    existing = {s.key for s in db.query(AppSettings).all()}
    for key, desc in SETTING_KEYS.items():
        if key not in existing:
            db.add(AppSettings(key=key, value=None, description=desc))
    db.commit()
    return db.query(AppSettings).order_by(AppSettings.key).all()


@router.put("/{key}", response_model=SettingResponse)
def upsert_setting(key: str, payload: SettingUpsert, db: Session = Depends(get_db)):
    setting = db.query(AppSettings).filter(AppSettings.key == key).first()
    if setting:
        setting.value = payload.value
    else:
        setting = AppSettings(key=key, value=payload.value)
        db.add(setting)
    db.commit()
    db.refresh(setting)
    return setting


@router.get("/{key}", response_model=SettingResponse)
def get_setting(key: str, db: Session = Depends(get_db)):
    setting = db.query(AppSettings).filter(AppSettings.key == key).first()
    if not setting:
        return SettingResponse(key=key, value=None, description=SETTING_KEYS.get(key))
    return setting
