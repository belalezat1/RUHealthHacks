FROM python:3.12.10-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_LINK_MODE=copy
WORKDIR /app/backend
RUN pip install --no-cache-dir uv==0.8.22
COPY backend/pyproject.toml backend/uv.lock ./

FROM base AS development
RUN uv sync --frozen --extra solver
COPY backend/ ./
COPY config/ /app/config/
COPY data/ /app/data/
ENV PATH="/app/backend/.venv/bin:$PATH"
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]

FROM base AS production
RUN uv sync --frozen --no-dev --extra solver && groupadd --system sevaro && useradd --system --gid sevaro sevaro
COPY backend/app/ ./app/
COPY backend/alembic/ ./alembic/
COPY backend/alembic.ini ./
COPY backend/scripts/ ./scripts/
COPY config/ /app/config/
COPY data/ /app/data/
ENV PATH="/app/backend/.venv/bin:$PATH"
USER sevaro
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/ready', timeout=2)"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
