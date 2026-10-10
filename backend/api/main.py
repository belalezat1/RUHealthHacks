"""FastAPI application: v1 API around the deterministic engine.

Run locally:  uvicorn backend.api.main:app --port 8000
"""
from __future__ import annotations

import logging
import secrets
import time
from contextlib import asynccontextmanager

from fastapi import Body, Depends, FastAPI, Header, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from ..core.data import load_reference
from . import auth
from .auth import Identity
from .config import Settings, load_settings
from .service import ApiError, Service
from .store import SCHEMA_VERSION, Store

log = logging.getLogger("sevaro.api")
COOKIE = "sevaro_session"


class LoginBody(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=256)


class ClockBody(BaseModel):
    minutes: float | None = Field(default=None, gt=0, le=24 * 60)
    to: str | None = None


class RunBody(BaseModel):
    label: str = Field(default="Fresh original fixture", max_length=120)


class ProposeBody(BaseModel):
    physician_ids: list[str] | None = None


class ReasonBody(BaseModel):
    reason: str = Field(default="", max_length=500)


class EscalateBody(BaseModel):
    risk_id: str = Field(max_length=120)
    consult_id: str | None = Field(default=None, max_length=40)
    note: str = Field(default="", max_length=500)


class AckBody(BaseModel):
    decision: str = Field(default="Acknowledged", max_length=500)


class ReassignBody(BaseModel):
    consult_id: str = Field(max_length=40)
    physician_id: str = Field(max_length=40)
    note: str = Field(default="", max_length=500)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        ref = load_reference(settings.data_dir)
        store = Store(settings.db_path)
        auth.seed_users(store, ref, settings.demo_password)
        service = Service(ref, store, settings.release_sha)
        service.startup()
        app.state.service = service
        app.state.store = store
        log.info("ready release=%s mode=%s db=%s", settings.release_sha, settings.mode, settings.db_path)
        yield
        service.ready = False
        store.close()

    app = FastAPI(title="Sevaro Intervention Desk API", version="1.0.0", lifespan=lifespan,
                  docs_url="/api/docs" if not settings.hosted else None, openapi_url="/api/openapi.json")
    app.state.settings = settings

    @app.middleware("http")
    async def envelope(request: Request, call_next):
        request.state.request_id = request.headers.get("x-request-id") or secrets.token_hex(8)
        t0 = time.perf_counter()
        response = await call_next(request)
        ms = (time.perf_counter() - t0) * 1000
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers["Server-Timing"] = f"app;dur={ms:.2f}"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        log.info('{"rid":"%s","method":"%s","path":"%s","status":%d,"ms":%.2f}', request.state.request_id,
                 request.method, request.url.path, response.status_code, ms)
        return response

    @app.exception_handler(ApiError)
    async def api_error(request: Request, exc: ApiError):
        return JSONResponse(status_code=exc.status, content={
            "error": {"code": exc.code, "message": exc.message, **exc.extra},
            "request_id": getattr(request.state, "request_id", None)})

    def svc(request: Request) -> Service:
        service: Service = request.app.state.service
        if not service.ready:
            raise ApiError(503, "not_ready", "Service is starting or rebuilding its projection")
        return service

    def identity(request: Request) -> Identity:
        ident = auth.resolve(request.app.state.store, request.cookies.get(COOKIE))
        if ident is None:
            raise ApiError(401, "unauthenticated", "Sign in required")
        return ident

    def check_origin(request: Request) -> None:
        origin = request.headers.get("origin")
        if settings.hosted:
            if not origin or origin.rstrip("/") not in settings.allowed_origins:
                raise ApiError(403, "bad_origin", "Request origin is not allowed")
        elif origin and settings.allowed_origins and origin.rstrip("/") not in settings.allowed_origins:
            raise ApiError(403, "bad_origin", "Request origin is not allowed")

    def writer(request: Request, ident: Identity = Depends(identity)) -> Identity:
        check_origin(request)
        token = request.headers.get("x-csrf-token", "")
        if not token or not secrets.compare_digest(token, ident.csrf_token):
            raise ApiError(403, "csrf", "Missing or invalid CSRF token")
        return ident

    def envelope_body(request: Request, service: Service, data: dict, engine_ms: float | None = None) -> dict:
        st = service.state()
        return {"request_id": request.state.request_id, "schema_version": SCHEMA_VERSION, "run_id": st["run_id"],
                "revision": st["revision"], "as_of": st["as_of"], "release_sha": st["release_sha"],
                "timing": {"engine_ms": engine_ms}, "data": data}

    def mutation(request: Request, service: Service, ident: Identity, route: str, fn, idem: str | None,
                 run: str | None, rev: str | None) -> dict:
        try:
            expected_rev = int(rev) if rev is not None else None
        except ValueError:
            raise ApiError(400, "invalid_revision", "X-Expected-Revision must be an integer")
        t0 = time.perf_counter()
        body = service.mutate(ident, idem, route, run, expected_rev, fn)
        return {"request_id": request.state.request_id, "schema_version": SCHEMA_VERSION,
                "timing": {"server_ms": round((time.perf_counter() - t0) * 1000, 3)}, **body}

    # ------------------------------------------------------------------ health
    @app.get("/health/live")
    def live():
        return {"status": "ok"}

    @app.get("/health/ready")
    def ready(request: Request):
        service: Service | None = getattr(request.app.state, "service", None)
        if service is None or not service.ready:
            return JSONResponse(status_code=503, content={"status": "starting"})
        st = service.state()
        return {"status": "ready", "release_sha": st["release_sha"], "schema_version": st["schema_version"],
                "revision": st["revision"]}

    # ------------------------------------------------------------------ session
    @app.post("/api/v1/session")
    def sign_in(request: Request, body: LoginBody):
        check_origin(request)
        result = auth.login(request.app.state.store, body.username, body.password, settings.session_hours)
        if result is None:
            raise ApiError(401, "invalid_credentials", "Username or password is incorrect")
        token, ident = result
        resp = JSONResponse({"user": ident.public(), "csrf_token": ident.csrf_token,
                             "request_id": request.state.request_id})
        resp.set_cookie(COOKIE, token, httponly=True, secure=settings.hosted, samesite="strict", path="/",
                        max_age=int(settings.session_hours * 3600))
        return resp

    @app.get("/api/v1/session")
    def whoami(request: Request, ident: Identity = Depends(identity)):
        return {"user": ident.public(), "csrf_token": ident.csrf_token, "mode": settings.mode,
                "request_id": request.state.request_id}

    @app.delete("/api/v1/session")
    def sign_out(request: Request, ident: Identity = Depends(writer)):
        auth.logout(request.app.state.store, request.cookies.get(COOKIE))
        resp = JSONResponse({"signed_out": True})
        resp.delete_cookie(COOKIE, path="/")
        return resp

    @app.get("/api/v1/demo-accounts")
    def demo_accounts(request: Request):
        """Local mode only: lets the login page list demo users and the shared local password."""
        if settings.hosted:
            raise ApiError(404, "not_found", "Not available in hosted mode")
        ref = request.app.state.service.ref
        return {"password": settings.demo_password, "accounts": auth.demo_accounts(ref)}

    # ------------------------------------------------------------------ reads
    @app.get("/api/v1/state")
    def state(request: Request, ident: Identity = Depends(identity)):
        service = svc(request)
        return {"request_id": request.state.request_id, **service.state()}

    @app.get("/api/v1/report")
    def report(request: Request, ident: Identity = Depends(identity)):
        service = svc(request)
        data = service.report(ident)
        engine_ms = None if data["evidence"]["projection_cache_hit"] else data["engine_timing_ms"]["total"]
        return envelope_body(request, service, data, engine_ms)

    @app.get("/api/v1/me/offers")
    def my_offers(request: Request, ident: Identity = Depends(identity)):
        service = svc(request)
        return envelope_body(request, service, service.physician_offers(ident))

    @app.get("/api/v1/audit.csv")
    def audit_csv(request: Request, ident: Identity = Depends(identity)):
        text = svc(request).audit_csv(ident)
        return PlainTextResponse(text, media_type="text/csv",
                                 headers={"Content-Disposition": 'attachment; filename="sevaro-audit.csv"'})

    @app.get("/api/v1/consults/{consult_id}/reassignment-targets")
    def reassignment_targets(request: Request, consult_id: str, ident: Identity = Depends(identity)):
        service = svc(request)
        return envelope_body(request, service, service.reassignment_targets(ident, consult_id))

    # ------------------------------------------------------------------ writes
    H = Header

    @app.post("/api/v1/events/validate")
    async def validate_events(request: Request, ident: Identity = Depends(writer)):
        text = (await request.body()).decode("utf-8-sig", errors="replace")
        service = svc(request)
        return envelope_body(request, service, service.validate_import(ident, text))

    @app.post("/api/v1/events/import")
    async def import_events(request: Request, filename: str = "upload.csv", advance_clock: bool = True,
                            ident: Identity = Depends(writer), idem: str | None = H(None, alias="Idempotency-Key"),
                            run: str | None = H(None, alias="X-Expected-Run"),
                            rev: str | None = H(None, alias="X-Expected-Revision")):
        raw = await request.body()
        if len(raw) > 5_000_000:
            raise ApiError(413, "too_large", "CSV larger than 5 MB")
        text = raw.decode("utf-8-sig", errors="replace")
        service = svc(request)
        return mutation(request, service, ident, "events/import",
                        lambda c, r: service.import_events(c, r, ident, text, filename[:120], advance_clock),
                        idem, run, rev)

    @app.post("/api/v1/clock")
    def clock(request: Request, body: ClockBody, ident: Identity = Depends(writer),
              idem: str | None = H(None, alias="Idempotency-Key"), run: str | None = H(None, alias="X-Expected-Run"),
              rev: str | None = H(None, alias="X-Expected-Revision")):
        service = svc(request)
        return mutation(request, service, ident, "clock",
                        lambda c, r: service.advance_clock(c, r, ident, body.minutes, body.to), idem, run, rev)

    @app.post("/api/v1/runs")
    def new_run(request: Request, body: RunBody = Body(default_factory=RunBody), ident: Identity = Depends(writer),
                idem: str | None = H(None, alias="Idempotency-Key"), run: str | None = H(None, alias="X-Expected-Run"),
                rev: str | None = H(None, alias="X-Expected-Revision")):
        service = svc(request)
        return mutation(request, service, ident, "runs", lambda c, r: service.new_run(c, r, ident, body.label),
                        idem, run, rev)

    @app.post("/api/v1/offers/propose")
    def propose(request: Request, body: ProposeBody = Body(default_factory=ProposeBody),
                ident: Identity = Depends(writer), idem: str | None = H(None, alias="Idempotency-Key"),
                run: str | None = H(None, alias="X-Expected-Run"),
                rev: str | None = H(None, alias="X-Expected-Revision")):
        service = svc(request)
        return mutation(request, service, ident, "offers/propose",
                        lambda c, r: service.propose(c, r, ident, body.physician_ids), idem, run, rev)

    def offer_route(action: str, handler):
        def endpoint(request: Request, offer_id: str, body: ReasonBody = Body(default_factory=ReasonBody),
                     ident: Identity = Depends(writer), idem: str | None = H(None, alias="Idempotency-Key"),
                     run: str | None = H(None, alias="X-Expected-Run"),
                     rev: str | None = H(None, alias="X-Expected-Revision")):
            service = svc(request)
            return mutation(request, service, ident, f"offers/{offer_id}/{action}",
                            lambda c, r: handler(service, c, r, ident, offer_id, body.reason), idem, run, rev)
        endpoint.__name__ = f"offer_{action}"
        app.post(f"/api/v1/offers/{{offer_id}}/{action}")(endpoint)

    offer_route("approve", lambda s, c, r, i, o, _: s.approve(c, r, i, o))
    offer_route("reject", lambda s, c, r, i, o, reason: s.reject(c, r, i, o, reason))
    offer_route("send", lambda s, c, r, i, o, _: s.send(c, r, i, o))
    offer_route("cancel", lambda s, c, r, i, o, reason: s.cancel(c, r, i, o, reason))
    offer_route("accept", lambda s, c, r, i, o, _: s.accept(c, r, i, o))
    offer_route("decline", lambda s, c, r, i, o, _: s.decline(c, r, i, o))

    @app.post("/api/v1/actions/escalate")
    def escalate(request: Request, body: EscalateBody, ident: Identity = Depends(writer),
                 idem: str | None = H(None, alias="Idempotency-Key"), run: str | None = H(None, alias="X-Expected-Run"),
                 rev: str | None = H(None, alias="X-Expected-Revision")):
        service = svc(request)
        return mutation(request, service, ident, "actions/escalate",
                        lambda c, r: service.escalate(c, r, ident, body.risk_id, body.consult_id, body.note),
                        idem, run, rev)

    @app.post("/api/v1/actions/{action_id}/acknowledge")
    def acknowledge(request: Request, action_id: str, body: AckBody = Body(default_factory=AckBody),
                    ident: Identity = Depends(writer), idem: str | None = H(None, alias="Idempotency-Key"),
                    run: str | None = H(None, alias="X-Expected-Run"),
                    rev: str | None = H(None, alias="X-Expected-Revision")):
        service = svc(request)
        return mutation(request, service, ident, f"actions/{action_id}/acknowledge",
                        lambda c, r: service.acknowledge(c, r, ident, action_id, body.decision), idem, run, rev)

    @app.post("/api/v1/actions/reassign")
    def reassign(request: Request, body: ReassignBody, ident: Identity = Depends(writer),
                 idem: str | None = H(None, alias="Idempotency-Key"), run: str | None = H(None, alias="X-Expected-Run"),
                 rev: str | None = H(None, alias="X-Expected-Revision")):
        service = svc(request)
        return mutation(request, service, ident, "actions/reassign",
                        lambda c, r: service.reassign(c, r, ident, body.consult_id, body.physician_id, body.note),
                        idem, run, rev)

    @app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
    def api_not_found(rest: str):
        raise ApiError(404, "not_found", "Unknown API route")

    if settings.static_dir and settings.static_dir.exists():
        app.mount("/", StaticFiles(directory=settings.static_dir, html=True), name="ui")

    return app


def _default_app() -> FastAPI:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    return create_app()


app = _default_app()  # uvicorn backend.api.main:app
