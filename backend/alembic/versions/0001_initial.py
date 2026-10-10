"""Initial namespaced operational state and uniqueness constraints.

Revision ID: 0001
"""
import sqlalchemy as sa

from alembic import op

revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('active_state', sa.Column('id', sa.Integer, primary_key=True),
                    sa.Column('dataset_id', sa.String(120)),
                    sa.Column('source_version', sa.Integer, nullable=False))
    op.execute("INSERT INTO active_state (id, source_version) VALUES (1, 0)")
    op.create_table('dataset_imports', sa.Column('id', sa.String(120), primary_key=True),
                    sa.Column('source_hash', sa.String(64), nullable=False),
                    sa.Column('schema_version', sa.String(30), nullable=False),
                    sa.Column('idempotency_key', sa.String(200), nullable=False, unique=True),
                    sa.Column('data', sa.JSON, nullable=False),
                    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False))
    for name in ['hospitals', 'physicians', 'physician_credentials', 'shifts', 'availability_signals',
                 'consultations', 'coverage_risks', 'recommendations', 'assignments', 'simulation_runs',
                 'advisory_results']:
        columns = [sa.Column('dataset_id', sa.String(120), primary_key=True),
                   sa.Column('id', sa.String(120), primary_key=True), sa.Column('data', sa.JSON, nullable=False)]
        if name in {'consultations', 'recommendations', 'assignments'}:
            columns.append(sa.Column('status', sa.String(40), nullable=False))
        if name == 'recommendations':
            columns += [sa.Column('source_version', sa.Integer, nullable=False),
                        sa.Column('workflow_version', sa.Integer, nullable=False),
                        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False)]
        if name == 'assignments':
            columns += [sa.Column('consultation_id', sa.String(120), nullable=False),
                        sa.Column('physician_id', sa.String(120), nullable=False)]
        op.create_table(name, *columns)
    for column, name in [('consultation_id', 'uq_active_consult'), ('physician_id', 'uq_active_physician')]:
        op.create_index(name, 'assignments', ['dataset_id', column], unique=True,
                        postgresql_where=sa.text("status IN ('assigned','verified')"))
    op.create_index('ix_consultations_status', 'consultations', ['status'])
    op.create_index('ix_recommendations_status', 'recommendations', ['status'])
    op.create_table('raw_events', sa.Column('id', sa.String(36), primary_key=True),
                    sa.Column('dataset_id', sa.String(120), nullable=False),
                    sa.Column('source', sa.String(120), nullable=False),
                    sa.Column('event_id', sa.String(120), nullable=False),
                    sa.Column('entity_id', sa.String(120), nullable=False),
                    sa.Column('event_type', sa.String(60), nullable=False),
                    sa.Column('semantic_hash', sa.String(64), nullable=False),
                    sa.Column('observed_at', sa.DateTime(timezone=True), nullable=False),
                    sa.Column('received_at', sa.DateTime(timezone=True), nullable=False),
                    sa.Column('data', sa.JSON, nullable=False), sa.Column('outcome', sa.String(30), nullable=False),
                    sa.UniqueConstraint('dataset_id', 'source', 'event_id'))
    op.create_index('ix_events_dataset_time', 'raw_events', ['dataset_id', 'received_at'])
    op.create_index('ix_raw_events_entity_id', 'raw_events', ['entity_id'])
    op.create_table('audit_logs', sa.Column('id', sa.String(36), primary_key=True),
                    sa.Column('dataset_id', sa.String(120), nullable=False),
                    sa.Column('actor', sa.String(120), nullable=False), sa.Column('role', sa.String(30), nullable=False),
                    sa.Column('action', sa.String(80), nullable=False),
                    sa.Column('entity_id', sa.String(120), nullable=False),
                    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
                    sa.Column('data', sa.JSON, nullable=False))
    op.create_index('ix_audit_dataset_time', 'audit_logs', ['dataset_id', 'created_at'])


def downgrade():
    for table in ['audit_logs', 'raw_events', 'advisory_results', 'simulation_runs', 'assignments',
                  'recommendations', 'coverage_risks', 'consultations', 'availability_signals', 'shifts',
                  'physician_credentials', 'physicians', 'hospitals', 'dataset_imports', 'active_state']:
        op.drop_table(table)
