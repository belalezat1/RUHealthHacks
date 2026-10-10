from functools import lru_cache

from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import ActiveState


@lru_cache
def engine():
    return create_engine(get_settings().database_url, pool_size=5, max_overflow=2,
                         pool_pre_ping=True, pool_timeout=10)


def get_session():
    with Session(engine(), expire_on_commit=False) as session:
        with session.begin():
            yield session


def locked_state(session: Session, read=False, require_dataset=True):
    row = session.scalar(select(ActiveState).where(ActiveState.id == 1).with_for_update(read=read))
    if row is None:
        raise HTTPException(503, 'Database not initialized; run migrations')
    if require_dataset and not row.dataset_id:
        raise HTTPException(409, 'No active dataset. Import a synthetic fixture in Simulation Lab.')
    return row
