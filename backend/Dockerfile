# API image: Python 3.12, one Uvicorn worker (the in-memory projection assumes a single writer).
# Build from the repository root:  docker build -f backend/Dockerfile -t sevaro-api:dev .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    SEVARO_STATE_DIR=/state \
    SEVARO_DATA_DIR=/app/data/original

WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt

COPY backend backend
COPY data/original data/original
COPY scripts scripts

RUN useradd --system --uid 10001 --home /app sevaro \
 && mkdir -p /state && chown sevaro /state
USER sevaro

ARG RELEASE_SHA=dev
ENV SEVARO_RELEASE_SHA=${RELEASE_SHA}
LABEL org.opencontainers.image.revision=${RELEASE_SHA}

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=2)"

# Uvicorn handles SIGTERM gracefully; SQLite commits are synchronous, so a stop never loses a committed write.
CMD ["uvicorn", "backend.api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", \
     "--proxy-headers", "--forwarded-allow-ips", "*", "--timeout-graceful-shutdown", "15"]
