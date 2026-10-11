"""Optional verified cost contract; unavailable in the supplied operational dataset.

Defining a type does not enable financial optimization or create any rate values.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class VerifiedCostRate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    source: str = Field(min_length=1, max_length=500)
    verified_by: str = Field(min_length=1, max_length=120)
    verified_at: datetime
    physician_id: str
    hospital_id: str
    service_scope: str
    currency: str = Field(pattern=r'^[A-Z]{3}$')
    unit: str = Field(pattern=r'^(physician_hour|consult|shift)$')
    amount: Decimal = Field(gt=0, allow_inf_nan=False)
    effective_from: datetime
    effective_until: datetime

    @model_validator(mode='after')
    def validate_dates(self):
        for value in (self.verified_at, self.effective_from, self.effective_until):
            if value.tzinfo is None:
                raise ValueError('Cost provenance and effective times require UTC offsets')
        if self.effective_until <= self.effective_from:
            raise ValueError('Cost effective interval is empty')
        return self


def financial_capability() -> dict:
    return {'configured': False, 'status': 'not_supplied', 'cost': None, 'currency': None,
            'unit': None, 'revenue': None, 'profit': None, 'verified_rates': [],
            'optimization_enabled': False,
            'note': 'No supplied compensation, contract, payer, reimbursement or HB/PB ownership evidence.'}
