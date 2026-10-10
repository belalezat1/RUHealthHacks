"""Integration tests use isolated schemas in a real PostgreSQL database."""
import os
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session


@pytest.fixture
def pg_engine():
    url = os.environ.get('TEST_DATABASE_URL')
    if not url:
        pytest.skip('TEST_DATABASE_URL required for real PostgreSQL integration tests')
    control = create_engine(url)
    schema = 'test_' + uuid4().hex
    with control.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA {schema}'))
    engine = create_engine(url, connect_args={'options': f'-csearch_path={schema}'}, pool_size=5)
    from app.models import ActiveState, Base
    Base.metadata.create_all(engine)
    with Session(engine) as session, session.begin():
        session.add(ActiveState(id=1, source_version=0))
    yield engine
    engine.dispose()
    with control.begin() as connection:
        connection.execute(text(f'DROP SCHEMA {schema} CASCADE'))
    control.dispose()


@pytest.fixture
def api(pg_engine, monkeypatch):
    from fastapi.testclient import TestClient

    from app.api import health, recommendations, simulations
    from app.core import database
    from app.core.clock import SimulationClock
    from app.main import create_app
    from app.services.datasets import examples

    monkeypatch.setattr(database, 'engine', lambda: pg_engine)
    monkeypatch.setattr(health, 'engine', lambda: pg_engine)
    monkeypatch.setattr(recommendations, 'engine', lambda: pg_engine)
    monkeypatch.setattr(simulations, 'engine', lambda: pg_engine)
    from datetime import UTC, datetime
    app = create_app()
    app.state.clock = SimulationClock(datetime(2026, 10, 10, 16, 0, tzinfo=UTC))
    with TestClient(app) as client:
        client.headers.update({'X-Demo-Role': 'dispatcher', 'X-Demo-Actor': 'demo-dispatcher'})
        fixtures = examples(app.state.clock.now())
        result = client.post('/v1/datasets/import', json=fixtures[0]['dataset'],
                             headers={'Idempotency-Key': 'initial-import'})
        assert result.status_code == 200, result.text
        yield client, app, fixtures
