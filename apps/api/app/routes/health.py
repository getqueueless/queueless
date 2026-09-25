from fastapi import APIRouter, Request, Response

from app.db import check_db

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@router.get("/ready")
async def ready(request: Request, response: Response) -> dict:
    if getattr(request.app.state, "shutting_down", False):
        response.status_code = 503
        return {"status": "shutting_down"}
    pool = request.app.state.db_pool
    if pool is None or not await check_db(pool):
        response.status_code = 503
        return {"status": "not_ready"}
    return {"status": "ready"}
