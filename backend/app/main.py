"""
main.py
FastAPI application factory — registers middleware, routers, and lifecycle hooks.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routers import problems, tutor, hints, sessions, notes, execute
from .services.gemini import get_gemini_model

# ── Logging ────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


# ── Lifespan ───────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Startup: validate config and warm up Gemini client.
    Shutdown: clean up resources.
    """
    settings = get_settings()
    logger.info("SocraticDS backend starting — env=%s", settings.app_env)
    logger.info("Gemini model: %s", settings.gemini_model)

    # Warm up Gemini client (validates API key at startup)
    try:
        get_gemini_model()
        logger.info("Gemini client initialised successfully")
    except Exception as exc:
        logger.error("Failed to initialise Gemini client: %s", exc)
        logger.error("Check that GEMINI_API_KEY is set in backend/.env")

    yield

    logger.info("SocraticDS backend shutting down")


# ── App factory ────────────────────────────────────────────────────

def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="SocraticDS API",
        description="Adaptive Socratic DSA tutoring backend",
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
    )

    # CORS — allow frontend dev server and production domain
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Session-Id"],   # must be listed for JS to read custom headers
    )

    # Register routers
    app.include_router(problems.router)
    app.include_router(tutor.router)
    app.include_router(hints.router)
    app.include_router(sessions.router)
    app.include_router(notes.router)
    app.include_router(execute.router)

    @app.get("/health", tags=["health"])
    async def health_check():
        """Health check endpoint for deployment monitoring."""
        return {
            "status": "ok",
            "model": settings.gemini_model,
            "env": settings.app_env,
        }

    return app


app = create_app()
