import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import Settings
from app.db import create_pool
from app.logging_config import configure_logging
from app.middleware import RequestIDMiddleware, SecurityHeadersMiddleware
from app.notifications import listen_task, poller_task
from app.routes import health, push_tokens

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
    app.state.db_pool = await create_pool(settings)
    app.state.listener_task = asyncio.create_task(listen_task(settings, app.state.db_pool))
    app.state.poller_task = asyncio.create_task(
        poller_task(app.state.db_pool, settings.poll_interval_seconds)
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
app.add_middleware(SecurityHeadersMiddleware, settings=settings)
app.add_middleware(RequestIDMiddleware)
app.include_router(health.router)
app.include_router(push_tokens.router)
