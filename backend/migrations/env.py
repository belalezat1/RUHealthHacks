"""Sevaro PostgreSQL migration environment."""
from alembic import context
from sqlalchemy import create_engine, pool

config = context.config
url = config.attributes.get('database_url') or config.get_main_option('sqlalchemy.url')
if context.is_offline_mode():
    context.configure(url=url, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    engine = create_engine(url, poolclass=pool.NullPool)
    with engine.connect() as connection:
        connection.exec_driver_sql('SELECT pg_advisory_lock(728414022)')
        connection.commit()
        try:
            context.configure(connection=connection)
            with context.begin_transaction():
                context.run_migrations()
        finally:
            connection.exec_driver_sql('SELECT pg_advisory_unlock(728414022)')
            connection.commit()
