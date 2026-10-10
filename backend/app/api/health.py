from fastapi import APIRouter, HTTPException
from sqlalchemy import text

from app.core.database import engine

router = APIRouter(tags=['health'])


@router.get('/health')
def health():
    return {'status': 'ok', 'service': 'sevaro-command-center'}


@router.get('/ready')
def ready():
    try:
        with engine().connect() as connection:
            connection.execute(text('SELECT id FROM active_state WHERE id = 1')).scalar_one()
        return {'status': 'ready', 'database': 'connected'}
    except Exception:
        raise HTTPException(503, 'Database unavailable or migrations pending') from None
