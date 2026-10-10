from typing import Literal

from pydantic import BaseModel, Field


class PreviewRequest(BaseModel):
    consultation_id: str
    method: Literal['greedy', 'baseline', 'cp_sat'] = 'greedy'


class ActionRequest(BaseModel):
    reason: str = Field(default='Reviewed in synthetic operations demo', max_length=1000)


class PhysicianResponse(ActionRequest):
    accepted: bool


class RecommendationResponse(BaseModel):
    id: str
    dataset_id: str
    status: str
    workflow_version: int
    source_version: int
    expires_at: str
    candidate: dict
    alternatives: list[dict]
    rejected: list[dict]
    solver: dict
    assumptions: list[str]
    advisory: dict
    consent: dict | None = None
    assignment_id: str | None = None
    verification: dict | None = None


class SimulationRequest(BaseModel):
    scenario: str = 'shift_ending_surge'
    seed: int = Field(default=42, ge=0, le=2147483647)


class SimulationResponse(BaseModel):
    id: str
    baseline: dict
    optimized: dict
    trace: list[dict]
    metadata: dict
