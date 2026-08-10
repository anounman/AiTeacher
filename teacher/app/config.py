"""Settings. Every external address is env-overridable — nothing is hardcoded
to one machine, which is what let the old repo leak tailnet hostnames into
source."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="TEACHER_", env_file=".env", extra="ignore")

    # Storage
    database_url: str = "postgresql+asyncpg://aiteacher:aiteacher@127.0.0.1:5433/aiteacher"

    # Neighbouring processes
    ollama_url: str = "http://127.0.0.1:11434"
    writer_url: str = "http://127.0.0.1:8931"

    # Single-user today, but every row is workspace-scoped so multi-tenant is
    # a config change rather than a migration (ARCHITECTURE_V2 §8).
    default_workspace_id: int = 1


@lru_cache
def settings() -> Settings:
    return Settings()
