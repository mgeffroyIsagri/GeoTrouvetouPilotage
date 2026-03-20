from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "GeoTrouvetouPilotage"
    debug: bool = False
    database_url: str = "sqlite:///./geotrouvetou.db"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
