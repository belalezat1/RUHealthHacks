"""Server settings. Runtime state is PostgreSQL and secrets stay server-side."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from ..core.data import DEFAULT_DATA_DIR

ROOT = Path(__file__).resolve().parents[2]
try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / '.env', override=False)
except ImportError:
    # Already-injected environments remain supported before installing dependencies.
    pass


@dataclass(frozen=True)
class Settings:
    mode: str
    state_dir: Path
    data_dir: Path
    allowed_origins: tuple[str, ...]
    demo_password: str
    release_sha: str
    session_hours: float
    static_dir: Path | None
    database_url: str = ''
    auto_migrate: bool = True
    policy_mode: str = 'challenge'

    @property
    def hosted(self) -> bool:
        return self.mode == 'hosted'

    @property
    def test_adapter(self) -> bool:
        return self.release_sha == 'test' and bool(self.demo_password) and not self.database_url

    @property
    def db_path(self) -> Path | str:
        if self.test_adapter:
            return self.state_dir / 'sevaro.sqlite3'
        return self.database_url or 'postgresql://b@127.0.0.1:55433/sevaro'


def load_settings() -> Settings:
    mode = os.environ.get('SEVARO_MODE', 'local').strip().lower()
    if mode not in ('local', 'hosted'):
        raise RuntimeError("SEVARO_MODE must be 'local' or 'hosted'")
    origins = tuple(o.strip().rstrip('/') for o in os.environ.get('SEVARO_ALLOWED_ORIGINS', '').split(',') if o.strip())
    if mode == 'hosted' and not origins:
        raise RuntimeError('Hosted mode requires explicit SEVARO_ALLOWED_ORIGINS')
    if mode == 'hosted' and os.environ.get('SEVARO_IDENTITY_MODE') != 'provisioned_sessions':
        raise RuntimeError('Hosted identity is not configured; trusted identity integration remains unverified')
    policy_mode = os.environ.get('SEVARO_POLICY_MODE', 'challenge').lower()
    if policy_mode not in ('challenge', 'production'):
        raise RuntimeError('SEVARO_POLICY_MODE must be challenge or production')
    static = os.environ.get('SEVARO_STATIC_DIR')
    default_static = ROOT / 'frontend' / 'dist'
    return Settings(
        mode=mode, state_dir=Path(os.environ.get('SEVARO_STATE_DIR', ROOT / 'state')),
        data_dir=Path(os.environ.get('SEVARO_DATA_DIR', DEFAULT_DATA_DIR)), allowed_origins=origins,
        demo_password='', release_sha=os.environ.get('SEVARO_RELEASE_SHA', 'dev'),
        session_hours=float(os.environ.get('SEVARO_SESSION_HOURS', '12')),
        static_dir=Path(static) if static else (default_static if default_static.exists() else None),
        database_url=os.environ.get('SEVARO_DATABASE_URL', 'postgresql://b@127.0.0.1:55433/sevaro'),
        auto_migrate=os.environ.get('SEVARO_AUTO_MIGRATE', 'false' if mode == 'hosted' else 'true').lower() == 'true', policy_mode=policy_mode,
    )
