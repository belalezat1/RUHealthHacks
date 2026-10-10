import json
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')
    app_env: Literal['local', 'test', 'production'] = 'local'
    database_url: str = 'postgresql+psycopg://sevaro:sevaro-local-only@localhost:5432/sevaro'
    auth_mode: Literal['demo', 'cognito'] = 'demo'
    cors_origins: list[str] = ['http://localhost:5173', 'http://127.0.0.1:5173']
    aws_region: str = ''
    datasets_bucket: str = ''
    cognito_user_pool_id: str = ''
    cognito_app_client_id: str = ''
    jev_mode: Literal['off', 'mock', 'live'] = 'mock'
    typesafe_api_key: str = ''
    jev_base_url: str = 'https://api.typesafe.ai'
    jev_model: str = 'jev-latest'
    jev_timeout_seconds: float = 5
    jev_max_retries: int = 1
    forecast_horizon_minutes: int = 90
    forecast_interval_minutes: int = 15
    max_solver_seconds: float = 0.25
    demo_policy_path: str = str(ROOT / 'config/demo_policies.json')
    max_upload_bytes: int = 2_000_000
    max_dataset_rows: int = 10000
    future_tolerance_seconds: int = 120

    @model_validator(mode='after')
    def secure_modes(self):
        if self.app_env == 'production' and self.auth_mode == 'demo':
            raise ValueError('Demo actors are forbidden in production')
        if self.auth_mode == 'cognito' and not all(
            [self.aws_region, self.cognito_user_pool_id, self.cognito_app_client_id]
        ):
            raise ValueError('Cognito requires region, user pool and app client')
        if self.jev_mode == 'live' and not self.typesafe_api_key:
            raise ValueError('JEV_MODE=live requires server-side TYPESAFE_API_KEY')
        if not 0 < self.jev_timeout_seconds <= 5 or not 0 <= self.jev_max_retries <= 1:
            raise ValueError('Jev deadline must be <=5 seconds, at most one retry')
        if self.forecast_horizon_minutes != 90 or self.forecast_interval_minutes != 15:
            raise ValueError('This demo supports six 15-minute bins')
        return self


@lru_cache
def get_settings():
    return Settings()


@lru_cache
def load_policy():
    policy = json.loads(Path(get_settings().demo_policy_path).read_text())
    if not policy.get('version') or not isinstance(policy.get('source_priority'), dict):
        raise ValueError('Demo policy requires version and explicit source precedence')
    policy['max_solver_seconds'] = get_settings().max_solver_seconds
    return policy
