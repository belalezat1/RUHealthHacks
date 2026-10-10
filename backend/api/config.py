"""Server-side configuration. Secrets come from the environment only, never from the frontend."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from ..core.data import DEFAULT_DATA_DIR

LOCAL_DEMO_PASSWORD = "sevaro-demo"


@dataclass(frozen=True)
class Settings:
    mode: str  # "local" or "hosted"
    state_dir: Path
    data_dir: Path
    allowed_origins: tuple[str, ...]
    demo_password: str
    release_sha: str
    session_hours: float
    static_dir: Path | None

    @property
    def hosted(self) -> bool:
        return self.mode == "hosted"

    @property
    def db_path(self) -> Path:
        return self.state_dir / "sevaro.sqlite3"


def load_settings() -> Settings:
    mode = os.environ.get("SEVARO_MODE", "local").strip().lower()
    if mode not in ("local", "hosted"):
        raise RuntimeError("SEVARO_MODE must be 'local' or 'hosted'")
    password = os.environ.get("SEVARO_DEMO_PASSWORD", "")
    if mode == "hosted" and len(password) < 12:
        raise RuntimeError("Hosted mode requires SEVARO_DEMO_PASSWORD (at least 12 characters)")
    origins = tuple(o.strip().rstrip("/") for o in os.environ.get("SEVARO_ALLOWED_ORIGINS", "").split(",") if o.strip())
    if mode == "hosted" and not origins:
        raise RuntimeError("Hosted mode requires SEVARO_ALLOWED_ORIGINS (e.g. https://dxxxx.cloudfront.net)")
    static = os.environ.get("SEVARO_STATIC_DIR")
    default_static = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    return Settings(
        mode=mode,
        state_dir=Path(os.environ.get("SEVARO_STATE_DIR", Path(__file__).resolve().parents[2] / "state")),
        data_dir=Path(os.environ.get("SEVARO_DATA_DIR", DEFAULT_DATA_DIR)),
        allowed_origins=origins,
        demo_password=password or LOCAL_DEMO_PASSWORD,
        release_sha=os.environ.get("SEVARO_RELEASE_SHA", "dev"),
        session_hours=float(os.environ.get("SEVARO_SESSION_HOURS", "12")),
        static_dir=Path(static) if static else (default_static if default_static.exists() else None),
    )
