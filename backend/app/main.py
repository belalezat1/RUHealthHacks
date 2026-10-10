import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError, OperationalError

from app.api import datasets, events, health, operations, recommendations, simulations
from app.core.clock import Clock
from app.core.config import get_settings
from app.core.logging import RequestLoggingMiddleware
from app.integrations.jev import get_adapter


@asynccontextmanager
async def lifespan(app):
    settings = get_settings()
    async with httpx.AsyncClient(timeout=settings.jev_timeout_seconds,
                                 limits=httpx.Limits(max_connections=5, max_keepalive_connections=2)) as client:
        app.state.jev = get_adapter(settings, client)
        yield


def create_app():
    settings = get_settings()
    logging.basicConfig(level=logging.INFO)
    app = FastAPI(title='Sevaro Command Center', version='0.1.0', lifespan=lifespan,
                  description='Synthetic operational demonstration. Rules and human decisions govern staffing.')
    app.state.clock = Clock()
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
                       allow_methods=['GET', 'POST'], allow_headers=['Authorization', 'Content-Type',
                       'Idempotency-Key', 'X-Demo-Actor', 'X-Demo-Role', 'X-Demo-Hospitals'])
    app.add_middleware(RequestLoggingMiddleware)

    @app.middleware('http')
    async def bounded_body(request: Request, call_next):
        if request.method in {'POST', 'PUT'}:
            size = 0
            chunks = []
            async for chunk in request.stream():
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    return JSONResponse(status_code=413, content={'detail': 'Request exceeds 2MB limit'})
                chunks.append(chunk)
            request._body = b''.join(chunks)
        return await call_next(request)

    @app.exception_handler(ValidationError)
    async def validation_error(request, exc):
        return JSONResponse(status_code=422, content={'detail': [
            {'path': '.'.join(map(str, e['loc'])), 'reason': e['msg']} for e in exc.errors()]})

    @app.exception_handler(IntegrityError)
    async def conflict(request, exc):
        return JSONResponse(status_code=409, content={'detail': 'Conflicting record or active assignment; refresh'})

    @app.exception_handler(OperationalError)
    async def unavailable(request, exc):
        return JSONResponse(status_code=503, content={'detail': 'Database unavailable; retry after readiness'})

    for router in [health.router, datasets.router, events.router, operations.router,
                   recommendations.router, simulations.router]:
        app.include_router(router)
    return app


app = create_app()
