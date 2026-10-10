from typing import Protocol

from app.schemas.events import Dataset


class SourceAdapter(Protocol):
    def parse(self, payload: dict) -> Dataset: ...
