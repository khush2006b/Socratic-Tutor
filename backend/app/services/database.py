"""
services/database.py
Supabase client — lazy singleton with graceful fallback.

If SUPABASE_URL / SUPABASE_KEY are not set, get_db() returns None
and all DB operations degrade to no-ops / in-memory fallbacks.
This lets the tutoring core work even without a configured database.
"""

import logging
from typing import Optional

logger = logging.getLogger(__name__)

_client = None
_init_attempted = False


def get_db():
    """
    Return the Supabase client, or None if not configured.
    Initialised once on first call (lazy singleton).
    """
    global _client, _init_attempted

    if _init_attempted:
        return _client

    _init_attempted = True

    try:
        from ..config import get_settings
        from supabase import create_client

        settings = get_settings()
        if not settings.db_enabled:
            logger.info("Supabase not configured — running without database persistence")
            return None

        _client = create_client(settings.supabase_url, settings.supabase_key)
        logger.info("Supabase client initialised: %s", settings.supabase_url)
        return _client

    except Exception as exc:
        logger.warning("Could not initialise Supabase client: %s", exc)
        return None
