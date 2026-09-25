from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import Settings
from app.db import create_pool
from app.logging_config import configure_logging
from app.middleware import RequestIDMiddleware, SecurityHeadersMiddleware
from app.routes import health, push_tokens

configure_logging()
settings = Settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.db_pool = await create_pool(settings)
    try:
        yield
    finally:
        await app.state.db_pool.close()


app = FastAPI(lifespan=lifespan)
app.state.settings = settings
app.add_middleware(SecurityHeadersMiddleware, settings=settings)
app.add_middleware(RequestIDMiddleware)
app.include_router(health.router)
app.include_router(push_tokens.router)
