"""Reference data loading for the Sevaro Challenge 2 synthetic dataset.

Everything here is immutable after load. Event data lives in ``events.py``.
"""
from __future__ import annotations

import csv
import hashlib
import math
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")

# The supplied schedule covers a single March day. Shift columns are "HH:MM" ET on this date.
SCENARIO_DATE = date(2026, 3, 17)
SCENARIO_NOW = datetime(2026, 3, 17, 18, 20, tzinfo=ET)
# Window in which the scenario clock and imported events are supported. Outside it the
# schedule is undefined, so we reject rather than silently reuse March shifts.
SUPPORTED_START = datetime(2026, 3, 17, 0, 0, tzinfo=ET)
SUPPORTED_END = datetime(2026, 3, 18, 7, 0, tzinfo=ET)

# Assumption (disclosed in the report): night shifts in the roster have no end time.
NIGHT_SHIFT_HOURS = 12

DEFAULT_DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "original"

SOURCE_FILES = (
    "event_stream.csv",
    "hospitals.csv",
    "physicians_on_shift.csv",
    "physicians_off_shift_roster.csv",
    "credentialing_matrix.csv",
    "baseline_hourly_volume.csv",
    "coverage_requirements.csv",
    "snapshot_physicians_1820.csv",
    "snapshot_open_consults_1820.csv",
)


@dataclass(frozen=True)
class Hospital:
    id: str
    name: str
    tz: str
    tier: str


@dataclass(frozen=True)
class Physician:
    id: str
    name: str
    on_roster_shift: bool  # True for the 8 on-shift physicians
    role: str  # Day / Night / Float
    shift_start: datetime | None
    shift_end: datetime | None
    opt_in: bool | None  # None for on-shift physicians ("n/a")
    last_shift_end: datetime | None
    next_shift_start: datetime | None
    hours_worked_7d: float
    minutes_to_online: int
    preferred_channel: str
    offers_declined_30d: int

    @property
    def is_night(self) -> bool:
        return self.role == "Night"

    def scheduled_intervals(self) -> list[tuple[datetime, datetime]]:
        """Known scheduled work intervals (today's shift and the next scheduled shift)."""
        out: list[tuple[datetime, datetime]] = []
        if self.shift_start and self.shift_end:
            out.append((self.shift_start, self.shift_end))
        if self.next_shift_start:
            out.append((self.next_shift_start, self.next_shift_start + timedelta(hours=NIGHT_SHIFT_HOURS)))
        return out


@dataclass(frozen=True)
class CoverageBlock:
    hospital_id: str
    start_min: int  # minutes after midnight ET
    end_min: int
    minimum: int

    def contains(self, minute_of_day: int) -> bool:
        if self.start_min < self.end_min:
            return self.start_min <= minute_of_day < self.end_min
        return minute_of_day >= self.start_min or minute_of_day < self.end_min


@dataclass(frozen=True)
class ReferenceData:
    hospitals: dict[str, Hospital]
    physicians: dict[str, Physician]
    credentials: dict[str, frozenset[str]]
    baseline: dict[tuple[str, int], tuple[float, int]]  # (hospital, hour) -> (mean, p90)
    coverage: tuple[CoverageBlock, ...]
    snapshot_physicians: tuple[dict, ...]
    snapshot_consults: tuple[dict, ...]
    source_hashes: dict[str, str]
    data_dir: Path
    scenario_date: date = SCENARIO_DATE
    scenario_now: datetime = SCENARIO_NOW
    baseline_by_day: dict[tuple[str, str, int], tuple[float, int]] | None = None

    @property
    def supported_start(self) -> datetime:
        return datetime.combine(self.scenario_date, time(), tzinfo=ET)

    @property
    def supported_end(self) -> datetime:
        # The schedule format defines one day and its overnight tail only.
        return self.supported_start + timedelta(days=1, hours=7)

    def credentialed(self, physician_id: str, hospital_id: str) -> bool:
        return hospital_id in self.credentials.get(physician_id, frozenset())

    def required_minimum(self, hospital_id: str, at: datetime) -> int:
        local = at.astimezone(ET)
        minute = local.hour * 60 + local.minute
        blocks = [b for b in self.coverage if b.hospital_id == hospital_id and b.contains(minute)]
        if len(blocks) != 1:
            raise ValueError(f"Expected one supplied coverage requirement for {hospital_id} at {local.isoformat()}")
        return blocks[0].minimum

    def baseline_for(self, hospital_id: str, at: datetime) -> tuple[float, int]:
        if self.baseline_by_day is not None:
            day = "weekend" if at.astimezone(ET).weekday() >= 5 else "weekday"
            value = self.baseline_by_day.get((hospital_id, day, at.astimezone(ET).hour))
            if value is None:
                raise ValueError(f"No supplied {day} baseline for {hospital_id} at hour {at.astimezone(ET).hour}")
            return value
        value = self.baseline.get((hospital_id, at.astimezone(ET).hour))
        if value is None:
            raise ValueError(f"No supplied hourly baseline for {hospital_id} at {at.isoformat()}")
        return value


def _hhmm(value: str) -> time:
    h, m = value.strip().split(":")
    return time(int(h), int(m))


def _on_date(value: str, on_date: date = SCENARIO_DATE) -> datetime:
    return datetime.combine(on_date, _hhmm(value), tzinfo=ET)


def _minutes(value: str) -> int:
    t = _hhmm(value)
    return t.hour * 60 + t.minute


def parse_instant(value: str) -> datetime:
    """Parse an ISO-8601 timestamp; naive timestamps are rejected."""
    dt = datetime.fromisoformat(value.strip())
    if dt.tzinfo is None or dt.utcoffset() is None:
        raise ValueError(f"timestamp has no UTC offset: {value!r}")
    return dt


def _read(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_reference(data_dir: Path | str = DEFAULT_DATA_DIR) -> ReferenceData:
    data_dir = Path(data_dir)
    source_events = _read(data_dir / "event_stream.csv")
    if not source_events:
        raise ValueError("The supplied event_stream.csv must contain a dated scenario")
    scenario_date = min(parse_instant(r["event_time"]) for r in source_events).astimezone(ET).date()
    scenario_now = datetime.combine(scenario_date, time(18, 20), tzinfo=ET)
    hospitals = {
        r["hospital_id"]: Hospital(r["hospital_id"], r["hospital_name"], r["local_timezone"], r["coverage_tier"])
        for r in _read(data_dir / "hospitals.csv")
    }

    physicians: dict[str, Physician] = {}
    for r in _read(data_dir / "physicians_on_shift.csv"):
        start, end = _on_date(r["shift_start_et"], scenario_date), _on_date(r["shift_end_et"], scenario_date)
        if end <= start:
            end += timedelta(days=1)
        physicians[r["physician_id"]] = Physician(
            id=r["physician_id"], name=r["name"], on_roster_shift=True, role="Day",
            shift_start=start, shift_end=end,
            opt_in=None, last_shift_end=None, next_shift_start=None,
            hours_worked_7d=0.0, minutes_to_online=0, preferred_channel="", offers_declined_30d=0,
        )
    for r in _read(data_dir / "physicians_off_shift_roster.csv"):
        physicians[r["physician_id"]] = Physician(
            id=r["physician_id"], name=r["name"], on_roster_shift=False, role=r["role"],
            shift_start=None, shift_end=None,
            opt_in=r["split_shift_opt_in"].strip().lower() == "yes",
            last_shift_end=parse_instant(r["last_shift_end"]),
            next_shift_start=parse_instant(r["next_shift_start"]),
            hours_worked_7d=float(r["hours_worked_last_7d"]),
            minutes_to_online=int(r["est_minutes_to_online"]),
            preferred_channel=r["preferred_channel"],
            offers_declined_30d=int(r["offers_declined_last_30d"]),
        )

    credentials: dict[str, frozenset[str]] = {}
    for r in _read(data_dir / "credentialing_matrix.csv"):
        credentials[r["physician_id"]] = frozenset(
            k for k, v in r.items() if k in hospitals and (v or "").strip().upper() == "Y"
        )

    baseline_rows = _read(data_dir / "baseline_hourly_volume.csv")
    baseline_by_day = {
        (r["hospital_id"], r["dow_type"].strip().lower(), _hhmm(r["hour_start_et"]).hour):
        (float(r["mean_consults"]), int(r["p90_consults"])) for r in baseline_rows
    }
    if any(not math.isfinite(mean) or mean < 0 or p90 < 0 for mean, p90 in baseline_by_day.values()):
        raise ValueError("Supplied baseline volumes must be finite and nonnegative")
    baseline = {
        (r["hospital_id"], _hhmm(r["hour_start_et"]).hour): (float(r["mean_consults"]), int(r["p90_consults"]))
        for r in baseline_rows
        if r["dow_type"] == ("weekend" if scenario_date.weekday() >= 5 else "weekday")
    }

    coverage = []
    for r in _read(data_dir / "coverage_requirements.csv"):
        start, end = r["time_block_et"].split("-")
        coverage.append(CoverageBlock(r["hospital_id"], _minutes(start), _minutes(end),
                                      int(r["min_available_credentialed_physicians"])))
    if any(block.minimum < 0 for block in coverage):
        raise ValueError("Supplied coverage minimums cannot be negative")

    hashes = {name: file_sha256(data_dir / name) for name in SOURCE_FILES if (data_dir / name).exists()}

    return ReferenceData(
        hospitals=hospitals,
        physicians=physicians,
        credentials=credentials,
        baseline=baseline,
        coverage=tuple(coverage),
        snapshot_physicians=tuple(_read(data_dir / "snapshot_physicians_1820.csv")),
        snapshot_consults=tuple(_read(data_dir / "snapshot_open_consults_1820.csv")),
        source_hashes=hashes,
        data_dir=data_dir,
        scenario_date=scenario_date,
        scenario_now=scenario_now,
        baseline_by_day=baseline_by_day,
    )
