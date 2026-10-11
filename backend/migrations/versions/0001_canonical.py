"""Canonical schema, immutable decisions and concurrency constraints."""
from alembic import op
from backend.api.store import MIGRATIONS

revision = '0001_canonical'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    for version in (1, 2):
        for statement in MIGRATIONS[version].split(';'):
            statement = statement.strip()
            if not statement:
                continue
            statement = statement.replace('INTEGER PRIMARY KEY AUTOINCREMENT', 'BIGSERIAL PRIMARY KEY')
            statement = statement.replace('accepted_start TEXT', 'accepted_start TIMESTAMPTZ')
            statement = statement.replace('accepted_end TEXT', 'accepted_end TIMESTAMPTZ')
            op.execute(statement)
    op.execute("INSERT INTO meta(key,value) VALUES('schema_version','2')")
    op.execute('CREATE EXTENSION IF NOT EXISTS btree_gist')
    op.execute("ALTER TABLE offers ADD CONSTRAINT no_accepted_overlap EXCLUDE USING gist "
               "(run_id WITH =, physician_id WITH =, tstzrange(accepted_start, accepted_end, '[)') WITH &&) "
               "WHERE (status = 'accepted')")
    op.execute("ALTER TABLE offers ADD CONSTRAINT accepted_interval_present CHECK "
               "(status <> 'accepted' OR (accepted_start IS NOT NULL AND accepted_end > accepted_start))")


def downgrade():
    raise RuntimeError('Destructive automatic downgrade is disabled. Restore a verified backup instead.')
