# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Pure recurrence calculation (no Django / DB access).

Conventions:
- Weekdays are numbered 0 = Monday ... 6 = Sunday (Python ``date.weekday()``).
- Weekly intervals are counted in calendar weeks starting at the Monday of the
  week that contains ``start_date``.
- Monthly rules on a day that does not exist in a month (e.g. 31 in February)
  fall back to the last day of that month.
- Monthly intervals are counted in calendar months starting at the month of
  ``start_date``.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone as dt_timezone
from typing import Iterator, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

FREQUENCY_DAILY = "daily"
FREQUENCY_WEEKLY = "weekly"
FREQUENCY_MONTHLY = "monthly"

END_NEVER = "never"
END_ON_DATE = "on_date"
END_AFTER_COUNT = "after_count"

# Local time (project timezone) at which an occurrence is created.
RUN_TIME = time(hour=6, minute=0)

# Safety limit for searching the next occurrence (in days / months).
_MAX_SEARCH_DAYS = 366 * 20
_MAX_SEARCH_MONTHS = 12 * 50


@dataclass(frozen=True)
class RecurrenceRule:
    frequency: str
    start_date: date
    interval: int = 1
    weekdays: list[int] = field(default_factory=list)
    month_day: Optional[int] = None
    end_type: str = END_NEVER
    end_date: Optional[date] = None
    max_occurrences: Optional[int] = None


def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _iter_daily(rule: RecurrenceRule, from_date: date) -> Iterator[date]:
    interval = max(rule.interval, 1)
    if from_date <= rule.start_date:
        current = rule.start_date
    else:
        diff = (from_date - rule.start_date).days
        steps = -(-diff // interval)  # ceil
        current = rule.start_date + timedelta(days=steps * interval)
    while True:
        yield current
        current += timedelta(days=interval)


def _iter_weekly(rule: RecurrenceRule, from_date: date) -> Iterator[date]:
    interval = max(rule.interval, 1)
    weekdays = sorted({int(w) for w in rule.weekdays if 0 <= int(w) <= 6})
    if not weekdays:
        return
    anchor = _monday(rule.start_date)
    current = max(from_date, rule.start_date)
    for _ in range(_MAX_SEARCH_DAYS):
        week_index = (_monday(current) - anchor).days // 7
        if week_index % interval == 0:
            if current.weekday() in weekdays:
                yield current
            current += timedelta(days=1)
        else:
            # jump to the Monday of the next matching week
            skip = interval - (week_index % interval)
            current = _monday(current) + timedelta(weeks=skip)
    return


def _iter_monthly(rule: RecurrenceRule, from_date: date) -> Iterator[date]:
    interval = max(rule.interval, 1)
    if not rule.month_day:
        return
    month_day = min(max(int(rule.month_day), 1), 31)
    lower = max(from_date, rule.start_date)
    year, month = rule.start_date.year, rule.start_date.month
    for _ in range(_MAX_SEARCH_MONTHS):
        last_day = calendar.monthrange(year, month)[1]
        candidate = date(year, month, min(month_day, last_day))
        if candidate >= lower:
            yield candidate
        month += interval
        while month > 12:
            month -= 12
            year += 1
    return


def iter_occurrences(rule: RecurrenceRule, from_date: date) -> Iterator[date]:
    """Yield occurrence dates >= ``from_date`` (and >= ``start_date``), ignoring the end condition."""
    if rule.frequency == FREQUENCY_DAILY:
        yield from _iter_daily(rule, from_date)
    elif rule.frequency == FREQUENCY_WEEKLY:
        yield from _iter_weekly(rule, from_date)
    elif rule.frequency == FREQUENCY_MONTHLY:
        yield from _iter_monthly(rule, from_date)


def is_within_end(rule: RecurrenceRule, occurrence: date, occurrence_count: int) -> bool:
    """Check the end condition for an occurrence (``occurrence_count`` = occurrences already created)."""
    if rule.end_type == END_ON_DATE and rule.end_date is not None:
        return occurrence <= rule.end_date
    if rule.end_type == END_AFTER_COUNT and rule.max_occurrences is not None:
        return occurrence_count < rule.max_occurrences
    return True


def next_occurrence(rule: RecurrenceRule, from_date: date, occurrence_count: int = 0) -> Optional[date]:
    """First occurrence >= ``from_date`` that is still within the end condition, else ``None``."""
    for occurrence in iter_occurrences(rule, from_date):
        if is_within_end(rule, occurrence, occurrence_count):
            return occurrence
        return None
    return None


def get_zone(tz_name: Optional[str]) -> ZoneInfo:
    try:
        return ZoneInfo(tz_name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def local_today(tz_name: Optional[str], now: datetime) -> date:
    """Today's date in the given timezone for the aware datetime ``now``."""
    return now.astimezone(get_zone(tz_name)).date()


def run_at_for(occurrence: date, tz_name: Optional[str], days_before: int = 0) -> datetime:
    """UTC datetime at which the work item for ``occurrence`` should be created."""
    run_day = occurrence - timedelta(days=max(days_before or 0, 0))
    local = datetime.combine(run_day, RUN_TIME, tzinfo=get_zone(tz_name))
    return local.astimezone(dt_timezone.utc)
