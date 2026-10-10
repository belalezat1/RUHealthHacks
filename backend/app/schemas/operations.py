from typing import Literal

from pydantic import BaseModel, Field


class Rule(BaseModel):
    code: str
    status: Literal['pass', 'fail', 'unknown']
    observed: object = None
    required: object = None
    source: str | None = None
    observed_at: str | None = None
    explanation: str = ''


class Eligibility(BaseModel):
    physician_id: str
    outcome: Literal['eligible', 'ineligible', 'unverified']
    action: str
    rules: list[Rule]


class HospitalInterval(BaseModel):
    hospital_id: str
    demand_minutes: float
    capacity_minutes: float
    unmet_minutes: float
    severity: str
    reason: str


class Interval(BaseModel):
    start_at: str
    end_at: str
    demand_minutes: float
    capacity_minutes: float
    unmet_minutes: float
    hospitals: list[HospitalInterval]


class Forecast(BaseModel):
    intervals: list[Interval]
    risks: list[dict]
    assumptions: list[str]
    as_of: str
    valid_until: str


class Counts(BaseModel):
    physicians: int
    consultations: int
    waiting: int
    assigned: int
    at_risk_hospitals: int
    pending_interventions: int


class Dashboard(BaseModel):
    dataset_id: str
    source_version: int
    as_of: str
    valid_until: str
    synthetic: bool = True
    counts: Counts
    physicians: list[dict]
    consultations: list[dict]
    hospitals: list[dict]
    forecast: Forecast
    recommendations: list[dict]
    jev: dict
    freshness: dict = Field(default_factory=dict)
