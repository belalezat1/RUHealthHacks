# Build from repository root. PostgreSQL is a separate service.
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    SEVARO_DATA_DIR=/app/data/original SEVARO_STATIC_DIR=/app/frontend/dist
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt
COPY backend backend
COPY data/original data/original
COPY --from=web /web/dist frontend/dist
RUN useradd --system --uid 10001 --home /app sevaro
USER sevaro
ARG RELEASE_SHA=dev
ENV SEVARO_RELEASE_SHA=${RELEASE_SHA}
LABEL org.opencontainers.image.revision=${RELEASE_SHA}
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=2)"
CMD ["uvicorn", "backend.api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--timeout-graceful-shutdown", "15"]
