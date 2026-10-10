"""Namespaced operational records. JSON preserves validated source evidence."""
from datetime import datetime

from sqlalchemy import JSON, DateTime, Index, Integer, String, UniqueConstraint, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class ActiveState(Base):
    __tablename__ = 'active_state'
    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    dataset_id: Mapped[str | None] = mapped_column(String(120))
    source_version: Mapped[int] = mapped_column(Integer, default=0)


class DatasetImport(Base):
    __tablename__ = 'dataset_imports'
    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    source_hash: Mapped[str] = mapped_column(String(64))
    schema_version: Mapped[str] = mapped_column(String(30))
    idempotency_key: Mapped[str] = mapped_column(String(200), unique=True)
    data: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class EntityMixin:
    dataset_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    data: Mapped[dict] = mapped_column(JSON)


class Hospital(EntityMixin, Base):
    __tablename__ = 'hospitals'


class Physician(EntityMixin, Base):
    __tablename__ = 'physicians'


class PhysicianCredential(EntityMixin, Base):
    __tablename__ = 'physician_credentials'


class Shift(EntityMixin, Base):
    __tablename__ = 'shifts'


class AvailabilitySignal(EntityMixin, Base):
    __tablename__ = 'availability_signals'


class Consultation(EntityMixin, Base):
    __tablename__ = 'consultations'
    status: Mapped[str] = mapped_column(String(40), index=True)


class RawEvent(Base):
    __tablename__ = 'raw_events'
    __table_args__ = (UniqueConstraint('dataset_id', 'source', 'event_id'),
                     Index('ix_events_dataset_time', 'dataset_id', 'received_at'))
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    dataset_id: Mapped[str] = mapped_column(String(120))
    source: Mapped[str] = mapped_column(String(120))
    event_id: Mapped[str] = mapped_column(String(120))
    entity_id: Mapped[str] = mapped_column(String(120), index=True)
    event_type: Mapped[str] = mapped_column(String(60))
    semantic_hash: Mapped[str] = mapped_column(String(64))
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    data: Mapped[dict] = mapped_column(JSON)
    outcome: Mapped[str] = mapped_column(String(30))


class CoverageRisk(EntityMixin, Base):
    __tablename__ = 'coverage_risks'


class Recommendation(EntityMixin, Base):
    __tablename__ = 'recommendations'
    status: Mapped[str] = mapped_column(String(40), index=True)
    source_version: Mapped[int] = mapped_column(Integer)
    workflow_version: Mapped[int] = mapped_column(Integer, default=1)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Assignment(EntityMixin, Base):
    __tablename__ = 'assignments'
    consultation_id: Mapped[str] = mapped_column(String(120))
    physician_id: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(40))
    __table_args__ = (
        Index('uq_active_consult', 'dataset_id', 'consultation_id', unique=True,
              postgresql_where=text("status IN ('assigned','verified')")),
        Index('uq_active_physician', 'dataset_id', 'physician_id', unique=True,
              postgresql_where=text("status IN ('assigned','verified')")),
    )


class AuditLog(Base):
    __tablename__ = 'audit_logs'
    __table_args__ = (Index('ix_audit_dataset_time', 'dataset_id', 'created_at'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    dataset_id: Mapped[str] = mapped_column(String(120))
    actor: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(30))
    action: Mapped[str] = mapped_column(String(80))
    entity_id: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    data: Mapped[dict] = mapped_column(JSON)


class SimulationRun(EntityMixin, Base):
    __tablename__ = 'simulation_runs'


class AdvisoryResult(EntityMixin, Base):
    __tablename__ = 'advisory_results'
