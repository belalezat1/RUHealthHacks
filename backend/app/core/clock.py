from datetime import UTC, datetime, timedelta


class Clock:
    def now(self) -> datetime:
        return datetime.now(UTC)


class SimulationClock(Clock):
    def __init__(self, current: datetime):
        self.current = current

    def now(self):
        return self.current

    def advance(self, minutes: float):
        self.current += timedelta(minutes=minutes)


def utc(value):
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace('Z', '+00:00'))
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
