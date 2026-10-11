# Full application image: built React frontend and one Python 3.12 API worker.
# Build from the repository root:  docker build -f backend/Dockerfile -t sevaro-api:dev .
FROM node:22-bookworm-slim AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    SEVARO_STATE_DIR=/state \
    SEVARO_DATA_DIR=/app/data/original \
    SEVARO_STATIC_DIR=/app/frontend/dist \
    PGSSLROOTCERT=/etc/ssl/certs/rds-global-bundle.pem

# Use sslmode=verify-full in the RDS database URL to verify its TLS identity.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && python -c "import urllib.request; urllib.request.urlretrieve('https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem', '/etc/ssl/certs/rds-global-bundle.pem')"

WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt

COPY backend backend
COPY data/original data/original
COPY scripts scripts
COPY --from=frontend-build /build/frontend/dist frontend/dist

# The deployment checkout uses umask 027; newly fetched files can be mode 640.
# Make bundled code/assets readable by the unprivileged application user.
RUN chmod -R a+rX /app \
 && useradd --system --uid 10001 --home /app sevaro \
 && mkdir -p /state && chown sevaro /state
USER sevaro

ARG RELEASE_SHA=dev
ENV SEVARO_RELEASE_SHA=${RELEASE_SHA}
LABEL org.opencontainers.image.revision=${RELEASE_SHA}

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=2)"

# Uvicorn handles SIGTERM gracefully; committed application state lives in PostgreSQL.
CMD ["uvicorn", "backend.api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", \
     "--proxy-headers", "--forwarded-allow-ips", "*", "--timeout-graceful-shutdown", "15"]
