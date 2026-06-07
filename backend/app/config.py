"""
config.py
Application settings loaded from environment variables.
Uses pydantic-settings for type-safe config with validation.
"""

from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # Gemini
    gemini_api_key: str = Field(..., description="Google Gemini API key")
    gemini_model: str = Field(
        default="gemini-2.5-flash",
        description="Gemini model name",
    )

    # Supabase (optional — app works without it, falls back to in-memory)
    supabase_url: Optional[str] = Field(default=None, description="Supabase project URL")
    supabase_key: Optional[str] = Field(default=None, description="Supabase anon/service key")
    supabase_jwt_secret: Optional[str] = Field(default=None, description="Supabase JWT secret for token verification")

    @property
    def db_enabled(self) -> bool:
        return bool(self.supabase_url and self.supabase_key)

    # CORS
    allowed_origins: str = Field(
        default="http://localhost:5173,http://localhost:5174",
        description="Comma-separated list of allowed origins",
    )

    # App
    app_env: str = Field(default="development")
    log_level: str = Field(default="INFO")

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",")]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached settings instance (loaded once at startup)."""
    return Settings()
