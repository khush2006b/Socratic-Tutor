"""
config.py
Application settings loaded from environment variables.
Uses pydantic-settings for type-safe config with validation.
"""

from typing import Optional #this is needed for the optional Supabase settings mentioned in the code. It allows us to specify that certain settings can be None if not provided. for 
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # Gemini — up to 3 API keys, rotated automatically on rate-limit
    gemini_api_key_1: Optional[str] = Field(default=None, description="Gemini API key 1")
    gemini_api_key_2: Optional[str] = Field(default=None, description="Gemini API key 2")
    gemini_api_key_3: Optional[str] = Field(default=None, description="Gemini API key 3")
    # Legacy single-key fallback
    gemini_api_key: Optional[str] = Field(default=None, description="Gemini API key (legacy single)")
    gemini_model: str = Field(
        default="gemini-2.5-flash",
        description="Gemini model name",
    )

    @property
    def gemini_api_keys(self) -> list[str]:
        """Return all configured Gemini API keys (non-empty, in order)."""
        keys = [self.gemini_api_key_1, self.gemini_api_key_2, self.gemini_api_key_3]
        keys = [k for k in keys if k]
        # Fallback to legacy single key
        if not keys and self.gemini_api_key:
            keys = [self.gemini_api_key]
        return keys

    # Supabase (optional — app works without it, falls back to in-memory)
    supabase_url: Optional[str] = Field(default=None, description="Supabase project URL") # This is the URL of your Supabase project, which is needed to connect to the database. If not provided, the app will use an in-memory store instead. why it store is in-memory? Because without a database connection, the app needs to keep data in memory while it's running. This means that any data will be lost when the app restarts, but it allows the app to function without a database.
    supabase_key: Optional[str] = Field(default=None, description="Supabase anon/service key")
    supabase_jwt_secret: Optional[str] = Field(default=None, description="Supabase JWT secret for token verification") #

    @property # 
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
