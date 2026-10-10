from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator


class SourceRecord(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1, max_length=120)


class Hospital(SourceRecord):
    name: str
    jurisdiction: str
    timezone: str = 'UTC'
    specialty: str = 'neurology'
    minimum_coverage: int = Field(default=0, ge=0, le=10)
    arrival_work_minutes_per_bin: float = Field(default=0, ge=0, le=1000)


class Physician(SourceRecord):
    name: str
    specialties: list[str]
    max_concurrent: Literal[1] = 1
    metadata: dict = Field(default_factory=dict)


class Credential(SourceRecord):
    physician_id: str
    kind: Literal['license', 'privilege']
    jurisdiction: str | None = None
    hospital_id: str | None = None
    expires_at: AwareDatetime | None = None


class Shift(SourceRecord):
    physician_id: str
    hospital_id: str
    start_at: AwareDatetime
    end_at: AwareDatetime
    status: Literal['scheduled', 'cancelled'] = 'scheduled'
    mandatory: bool = False

    @model_validator(mode='after')
    def interval(self):
        if self.end_at <= self.start_at:
            raise ValueError('Shift end must be after start')
        return self


class Signal(SourceRecord):
    physician_id: str
    source: str
    kind: Literal['heartbeat', 'self_report', 'activity', 'activation']
    value: Literal['connected', 'disconnected', 'available', 'unavailable', 'busy', 'active']
    observed_at: AwareDatetime
    received_at: AwareDatetime | None = None
    source_sequence: int | None = Field(default=None, ge=0)


class Consultation(SourceRecord):
    hospital_id: str
    specialty: str
    priority: Literal['urgent', 'routine']
    requested_at: AwareDatetime
    deadline_at: AwareDatetime
    duration_minutes: int = Field(ge=1, le=240)
    status: Literal['waiting', 'assigned', 'active', 'completed'] = 'waiting'
    physician_id: str | None = None

    @model_validator(mode='after')
    def timing(self):
        if self.deadline_at < self.requested_at:
            raise ValueError('Deadline precedes request')
        if self.status in {'assigned', 'active'} and not self.physician_id:
            raise ValueError('Active work requires physician evidence')
        return self


class Dataset(BaseModel):
    model_config = ConfigDict(extra='forbid')
    schema_version: Literal['synthetic_v1']
    dataset_id: str = Field(min_length=1, max_length=120, pattern=r'^[a-zA-Z0-9_-]+$')
    label: str
    synthetic: Literal[True]
    as_of: AwareDatetime
    hospitals: list[Hospital] = Field(min_length=1, max_length=100)
    physicians: list[Physician] = Field(min_length=1, max_length=1000)
    credentials: list[Credential] = Field(max_length=10000)
    shifts: list[Shift] = Field(max_length=10000)
    signals: list[Signal] = Field(max_length=10000)
    consultations: list[Consultation] = Field(max_length=10000)

    @model_validator(mode='after')
    def references(self):
        for group in ['hospitals', 'physicians', 'credentials', 'shifts', 'signals', 'consultations']:
            ids = [row.id for row in getattr(self, group)]
            if len(ids) != len(set(ids)):
                raise ValueError(f'{group}: duplicate source ID')
        physicians = {p.id for p in self.physicians}
        hospitals = {h.id for h in self.hospitals}
        for group in ['credentials', 'shifts', 'signals', 'consultations']:
            for row in getattr(self, group):
                if getattr(row, 'physician_id', None) and row.physician_id not in physicians:
                    raise ValueError(f'{group}.{row.id}.physician_id: unknown physician')
                if getattr(row, 'hospital_id', None) and row.hospital_id not in hospitals:
                    raise ValueError(f'{group}.{row.id}.hospital_id: unknown hospital')
        return self


class Event(BaseModel):
    model_config = ConfigDict(extra='forbid')
    dataset_id: str = Field(min_length=1, max_length=120)
    source: str = Field(min_length=1, max_length=120)
    event_id: str = Field(min_length=1, max_length=120)
    event_type: Literal['availability', 'consultation.created', 'consultation.completed', 'activation']
    entity_id: str = Field(min_length=1, max_length=120)
    observed_at: AwareDatetime
    source_sequence: int | None = Field(default=None, ge=0)
    payload: dict

    @field_validator('payload')
    @classmethod
    def limit_payload(cls, value):
        import json
        if len(json.dumps(value)) > 50000:
            raise ValueError('Event payload exceeds 50KB')
        return value


class Batch(BaseModel):
    events: list[Event] = Field(min_length=1, max_length=100)


class ValidationIssue(BaseModel):
    path: str
    field: str
    reason: str


class ValidationReport(BaseModel):
    valid: bool
    errors: list[ValidationIssue]
    counts: dict[str, int]


class ImportResult(BaseModel):
    dataset_id: str
    source_version: int
    duplicate: bool


class EventResult(BaseModel):
    event_id: str
    outcome: Literal['applied', 'duplicate', 'late']
    source_version: int


class EventPage(BaseModel):
    items: list[dict]
    total: int
