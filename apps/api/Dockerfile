FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder
# Must match the runtime stage's WORKDIR: uv bakes this absolute path into
# console-script shebangs (e.g. .venv/bin/uvicorn), so a mismatch here means
# "no such file or directory" at runtime even though the venv copied fine.
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

FROM python:3.12-slim
RUN useradd -u 10001 appuser
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY app ./app
COPY scripts ./scripts
# --chown, not a separate `RUN chown`: /admin/retrain writes a new model
# file + model_meta.json at runtime (tmp-then-os.replace swap) as appuser,
# so appuser must own ml/, not just be able to read it.
COPY --chown=appuser:appuser ml ./ml
ENV PATH="/app/.venv/bin:$PATH"
# Default only -- prod routing decides the real value at container runtime.
ENV PORT=8000
USER appuser

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://localhost:{os.environ.get(\"PORT\", \"8000\")}/health')"

CMD uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --timeout-graceful-shutdown 30
