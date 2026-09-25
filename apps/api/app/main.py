import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler
from slowapi.middleware import SlowAPIMiddleware

from app.ai_client import get_deepseek_client
from app.config import Settings
from app.db import create_pool
from app.errors import register_exception_handlers
from app.logging_config import configure_logging
from app.middleware import RequestIDMiddleware, SecurityHeadersMiddleware
from app.ml_runtime import load as load_ml
from app.notifications import listen_task, poller_task
from app.rate_limit import limiter
from app.routes import admin, ai, health, predict, staff
from app.translate import TranslateDeps

configure_logging()
settings = Settings()


async def _cancel(task: asyncio.Task | None) -> None:
    if task is None:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.shutting_down = False
    load_ml(app)
    app.state.deepseek_client = get_deepseek_client(settings)
    translate_deps = TranslateDeps(
        client=app.state.deepseek_client,
        model=settings.deepseek_model,
        max_tokens=settings.deepseek_max_tokens,
        cache_size=settings.translate_cache_size,
    )
    app.state.db_pool = await create_pool(settings)
    app.state.listener_task = asyncio.create_task(
        listen_task(settings, app.state.db_pool, translate_deps=translate_deps)
    )
    app.state.poller_task = asyncio.create_task(
        poller_task(app.state.db_pool, settings.poll_interval_seconds, translate_deps=translate_deps)
    )
    try:
        yield
    finally:
        app.state.shutting_down = True
        await _cancel(app.state.listener_task)
        await _cancel(app.state.poller_task)
        await app.state.db_pool.close()


app = FastAPI(lifespan=lifespan)
app.state.settings = settings
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
register_exception_handlers(app)

app.add_middleware(SecurityHeadersMiddleware, settings=settings)
app.add_middleware(RequestIDMiddleware)
# ASGI-level, so it enforces limits even when a route's own auth dependency
# would otherwise reject the request before the decorated handler body runs.
app.add_middleware(SlowAPIMiddleware)
# Added last so it is outermost -- CORS must run before everything else.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(predict.router)
app.include_router(admin.router)
app.include_router(staff.router)
app.include_router(ai.router)

Instrumentator().instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)
