# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Recurrence calculation (pure functions, no DB)."""

from datetime import date, datetime, timezone as dt_timezone
from itertools import islice

import pytest

from plane.ext.recurring import schedule
from plane.ext.recurring.schedule import RecurrenceRule


def take(rule, from_date, n):
    return list(islice(schedule.iter_occurrences(rule, from_date), n))


@pytest.mark.unit
class TestDaily:
    def test_every_day(self):
        rule = RecurrenceRule(frequency="daily", start_date=date(2026, 1, 1))
        assert take(rule, date(2026, 1, 1), 3) == [date(2026, 1, 1), date(2026, 1, 2), date(2026, 1, 3)]

    def test_interval_is_anchored_at_start_date(self):
        rule = RecurrenceRule(frequency="daily", start_date=date(2026, 1, 1), interval=3)
        # 1, 4, 7, 10 ... -> first one on/after the 5th is the 7th
        assert take(rule, date(2026, 1, 5), 2) == [date(2026, 1, 7), date(2026, 1, 10)]

    def test_from_date_before_start(self):
        rule = RecurrenceRule(frequency="daily", start_date=date(2026, 3, 10), interval=2)
        assert take(rule, date(2026, 1, 1), 1) == [date(2026, 3, 10)]


@pytest.mark.unit
class TestWeekly:
    def test_every_tuesday(self):
        # 2026-11-03 is a Tuesday
        rule = RecurrenceRule(frequency="weekly", start_date=date(2026, 11, 1), weekdays=[1])
        assert take(rule, date(2026, 11, 1), 3) == [date(2026, 11, 3), date(2026, 11, 10), date(2026, 11, 17)]

    def test_multiple_weekdays(self):
        # Monday + Thursday
        rule = RecurrenceRule(frequency="weekly", start_date=date(2026, 11, 2), weekdays=[3, 0])
        assert take(rule, date(2026, 11, 2), 4) == [
            date(2026, 11, 2),
            date(2026, 11, 5),
            date(2026, 11, 9),
            date(2026, 11, 12),
        ]

    def test_every_second_week_counted_from_start_week(self):
        # start Wednesday 2026-11-04 -> its week (Mon 2026-11-02) is week 0
        rule = RecurrenceRule(frequency="weekly", start_date=date(2026, 11, 4), weekdays=[0, 4], interval=2)
        # Monday 2026-11-02 is before the start date and is not returned; Friday 2026-11-06 is.
        assert take(rule, date(2026, 11, 1), 4) == [
            date(2026, 11, 6),
            date(2026, 11, 16),
            date(2026, 11, 20),
            date(2026, 11, 30),
        ]

    def test_no_weekdays_yields_nothing(self):
        rule = RecurrenceRule(frequency="weekly", start_date=date(2026, 11, 4), weekdays=[])
        assert take(rule, date(2026, 11, 1), 1) == []


@pytest.mark.unit
class TestMonthly:
    def test_day_of_month(self):
        rule = RecurrenceRule(frequency="monthly", start_date=date(2026, 1, 20), month_day=15)
        assert take(rule, date(2026, 1, 1), 3) == [date(2026, 2, 15), date(2026, 3, 15), date(2026, 4, 15)]

    def test_day_31_falls_back_to_last_day(self):
        rule = RecurrenceRule(frequency="monthly", start_date=date(2027, 1, 1), month_day=31)
        assert take(rule, date(2027, 1, 1), 4) == [
            date(2027, 1, 31),
            date(2027, 2, 28),
            date(2027, 3, 31),
            date(2027, 4, 30),
        ]

    def test_leap_year(self):
        rule = RecurrenceRule(frequency="monthly", start_date=date(2028, 2, 1), month_day=30)
        assert take(rule, date(2028, 2, 1), 1) == [date(2028, 2, 29)]

    def test_interval_and_year_rollover(self):
        rule = RecurrenceRule(frequency="monthly", start_date=date(2026, 11, 1), month_day=1, interval=3)
        assert take(rule, date(2026, 11, 2), 3) == [date(2027, 2, 1), date(2027, 5, 1), date(2027, 8, 1)]


@pytest.mark.unit
class TestEndConditions:
    def test_end_on_date(self):
        rule = RecurrenceRule(
            frequency="daily", start_date=date(2026, 1, 1), end_type="on_date", end_date=date(2026, 1, 2)
        )
        assert schedule.next_occurrence(rule, date(2026, 1, 2)) == date(2026, 1, 2)
        assert schedule.next_occurrence(rule, date(2026, 1, 3)) is None

    def test_end_after_count(self):
        rule = RecurrenceRule(frequency="daily", start_date=date(2026, 1, 1), end_type="after_count", max_occurrences=2)
        assert schedule.next_occurrence(rule, date(2026, 1, 1), occurrence_count=1) == date(2026, 1, 1)
        assert schedule.next_occurrence(rule, date(2026, 1, 1), occurrence_count=2) is None

    def test_never(self):
        rule = RecurrenceRule(frequency="daily", start_date=date(2026, 1, 1))
        assert schedule.next_occurrence(rule, date(2040, 5, 5), occurrence_count=10_000) == date(2040, 5, 5)


@pytest.mark.unit
class TestTimezone:
    def test_run_at_berlin_winter(self):
        # 06:00 CET = 05:00 UTC
        assert schedule.run_at_for(date(2026, 12, 1), "Europe/Berlin") == datetime(
            2026, 12, 1, 5, 0, tzinfo=dt_timezone.utc
        )

    def test_run_at_berlin_summer(self):
        # 06:00 CEST = 04:00 UTC
        assert schedule.run_at_for(date(2026, 7, 1), "Europe/Berlin") == datetime(
            2026, 7, 1, 4, 0, tzinfo=dt_timezone.utc
        )

    def test_run_at_around_dst_changes(self):
        # DST starts 2026-03-29 and ends 2026-10-25 in Europe/Berlin
        assert schedule.run_at_for(date(2026, 3, 28), "Europe/Berlin").hour == 5
        assert schedule.run_at_for(date(2026, 3, 29), "Europe/Berlin").hour == 4
        assert schedule.run_at_for(date(2026, 10, 24), "Europe/Berlin").hour == 4
        assert schedule.run_at_for(date(2026, 10, 25), "Europe/Berlin").hour == 5

    def test_days_before(self):
        assert schedule.run_at_for(date(2026, 12, 4), "UTC", days_before=3) == datetime(
            2026, 12, 1, 6, 0, tzinfo=dt_timezone.utc
        )

    def test_unknown_timezone_falls_back_to_utc(self):
        assert schedule.run_at_for(date(2026, 12, 1), "Not/AZone").hour == 6

    def test_local_today(self):
        # 23:30 UTC on Nov 7 is already Nov 8 in Berlin
        now = datetime(2026, 11, 7, 23, 30, tzinfo=dt_timezone.utc)
        assert schedule.local_today("Europe/Berlin", now) == date(2026, 11, 8)
        assert schedule.local_today("UTC", now) == date(2026, 11, 7)
