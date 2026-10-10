"""Idempotent local seed. Reset requires an explicit synthetic dataset ID."""
import argparse
import sys
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.config import get_settings
from app.core.database import engine, locked_state
from app.core.security import Actor
from app.models import AdvisoryResult, CoverageRisk, DatasetImport, RawEvent, Recommendation, SimulationRun
from app.services.audit import record
from app.services.datasets import ENTITY_TABLES, activate, examples


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dataset')
    parser.add_argument('--reset', action='store_true')
    args = parser.parse_args()
    if get_settings().app_env not in {'local', 'test'}:
        parser.error('This synthetic seed/reset command is local-only')
    if args.reset and not args.dataset:
        parser.error('--reset requires an explicitly selected --dataset ID')
    now = Clock().now()
    fixtures = examples(now)
    selected = next((f for f in fixtures if not args.dataset or f['id'] == args.dataset), None)
    if not selected:
        parser.error('Unknown synthetic fixture dataset ID')
    identifier = selected['id']
    actor = Actor('demo-seed', 'admin', synthetic=True)
    with Session(engine()) as session, session.begin():
        active = locked_state(session, require_dataset=False)
        existing = session.get(DatasetImport, identifier)
        if existing and not args.reset:
            print(f'{identifier} already imported; seed is a no-op. Use explicit demo-reset to rebase time.')
            return
        if args.reset:
            if existing and existing.schema_version != 'synthetic_v1':
                parser.error('Refusing to reset a non-synthetic dataset')
            for model in [*ENTITY_TABLES.values(), Recommendation, RawEvent, CoverageRisk,
                          AdvisoryResult, SimulationRun]:
                session.execute(delete(model).where(model.dataset_id == identifier))
            session.execute(delete(DatasetImport).where(DatasetImport.id == identifier))
            # Audit history is append-only and is preserved across explicit resets.
            record(session, actor, identifier, 'dataset.demo_reset', identifier, now,
                   reason='Explicitly selected synthetic fixture; database volume retained')
        result = activate(session, active, selected['dataset'], f'seed:{identifier}:{uuid4()}', actor, now)
        print(result)


if __name__ == '__main__':
    main()
