from fastapi import APIRouter, Depends, Request

from app.auth import AuthedProfile, require_org_role

router = APIRouter()


@router.get("/staff/insights")
async def get_staff_insights(
    request: Request, profile: AuthedProfile = Depends(require_org_role("staff", "admin"))
) -> dict:
    # org_id comes only from the server-side profile lookup (require_org_role)
    # -- never from a client-supplied header/path/query/body value. Every
    # query below filters by it directly; tokens.org_id is a direct column,
    # no join needed to enforce this.
    pool = request.app.state.db_pool
    org_id = profile.org_id

    # "Today" is each token's own service_day (a real stored column, set
    # once at token creation) -- not a UTC/local current_date comparison,
    # which is exactly the bug class app/routes/predict.py hit (see
    # docs/DECISIONS.md). The most recent service_day this org has any
    # token for stands in for "today" without needing organizations.timezone
    # (a table/column queueless_api has no grant on anyway).
    today = await pool.fetchval(
        "SELECT max(service_day) FROM tokens WHERE org_id = $1", org_id
    )

    counters = []
    services = []

    if today is not None:
        counter_rows = await pool.fetch(
            """
            SELECT counter_id,
                   count(*) FILTER (WHERE status = 'done') AS served,
                   count(*) FILTER (WHERE status = 'no_show') AS no_show,
                   avg(extract(epoch from (finished_at - serving_at)) / 60)
                       FILTER (WHERE status = 'done' AND finished_at IS NOT NULL AND serving_at IS NOT NULL)
                       AS avg_service_minutes
            FROM tokens
            WHERE org_id = $1 AND service_day = $2 AND counter_id IS NOT NULL
            GROUP BY counter_id
            """,
            org_id,
            today,
        )
        # queueless_api has no grant on public.counters (0018) -- return the
        # raw id rather than blocking the endpoint on a nice-to-have name.
        counters = [
            {
                "counter_id": str(row["counter_id"]),
                "served_today": row["served"],
                "no_show_today": row["no_show"],
                "avg_service_minutes": float(row["avg_service_minutes"]) if row["avg_service_minutes"] is not None else None,
            }
            for row in counter_rows
        ]

        service_rows = await pool.fetch(
            "SELECT service_id, waiting_count, avg_service_secs "
            "FROM board_services WHERE org_id = $1 AND day = $2",
            org_id,
            today,
        )
        services = [
            {
                "service_id": str(row["service_id"]),
                "waiting_count": row["waiting_count"],
                "avg_service_secs": row["avg_service_secs"],
            }
            for row in service_rows
        ]

    return {"org_id": str(org_id), "today": str(today) if today else None, "counters": counters, "services": services}
