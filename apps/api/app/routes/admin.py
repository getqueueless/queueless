from fastapi import APIRouter, Depends, Request

from app.auth import AuthedUser, require_role

router = APIRouter()

_MODEL_REPORT_FIELDS = (
    "version",
    "trained_at",
    "trained_on",
    "mae_model",
    "mae_baseline",
    "split_method",
    "n_rows",
    "mae_model_by_service",
)


@router.get("/admin/model")
async def get_model_report(
    request: Request, user: AuthedUser = Depends(require_role("admin"))
) -> dict:
    # A model is process-wide, not per-org, so a plain role check (not
    # require_org_role) is enough here -- there's no org-scoped data to leak.
    meta = request.app.state.ml_meta
    return {field: meta.get(field) for field in _MODEL_REPORT_FIELDS}
