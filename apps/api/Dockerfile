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
COPY ml ./ml
ENV PATH="/app/.venv/bin:$PATH"
USER appuser

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/health')"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--timeout-graceful-shutdown", "30"]
