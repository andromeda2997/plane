# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import hashlib
import re
from datetime import date, datetime, timezone

import pytest

from plane.ext.calendar_feed.ics import AllDayEvent, build_calendar, escape_text, fold_line
from plane.ext.calendar_feed.models import CalendarFeed, generate_token, hash_token


def _unfold(text: str) -> str:
    return text.replace("\r\n ", "")


@pytest.mark.unit
class TestEscaping:
    def test_backslash_first_then_specials(self):
        assert escape_text("a\\b;c,d") == "a\\\\b\\;c\\,d"

    def test_newlines(self):
        assert escape_text("eins\r\nzwei\ndrei\rvier") == "eins\\nzwei\\ndrei\\nvier"

    def test_control_chars_removed(self):
        assert escape_text("a\x00b\x07c\td") == "abc\td"

    def test_none(self):
        assert escape_text(None) == ""


@pytest.mark.unit
class TestFolding:
    def test_short_line_unchanged(self):
        assert fold_line("SUMMARY:kurz") == "SUMMARY:kurz"

    def test_long_ascii_line_folded_at_75_octets(self):
        line = "SUMMARY:" + "x" * 200
        folded = fold_line(line)
        physical = folded.split("\r\n")
        assert len(physical) > 1
        assert all(len(part.encode("utf-8")) <= 75 for part in physical)
        assert all(part.startswith(" ") for part in physical[1:])
        assert len(physical[0].encode("utf-8")) == 75
        assert _unfold(folded) == line

    @pytest.mark.parametrize("char", ["ä", "€", "🗓"])
    def test_multibyte_never_split(self, char):
        line = "SUMMARY:" + char * 100
        folded = fold_line(line)
        for part in folded.split("\r\n"):
            # Würde ein Mehrbyte-Zeichen zerteilt, schlüge das Dekodieren fehl.
            encoded = part.encode("utf-8")
            assert len(encoded) <= 75
            encoded.decode("utf-8")
        assert _unfold(folded) == line


@pytest.mark.unit
class TestCalendar:
    def _calendar(self, **event_kwargs):
        event = AllDayEvent(
            uid="abc@plane",
            summary="[NYA-1] Bericht; Teil 1, Entwurf",
            start=date(2026, 3, 30),
            end=date(2026, 3, 31),
            url="https://plane.example.test/ws/browse/NYA-1/",
            status="CONFIRMED",
            categories=["In Arbeit, bald fertig"],
            last_modified=datetime(2026, 3, 1, 12, 0, tzinfo=timezone.utc),
            **event_kwargs,
        )
        return build_calendar(
            name="Plane – NYA",
            events=[event],
            dtstamp=datetime(2026, 3, 2, 8, 30, tzinfo=timezone.utc),
        )

    def test_structure_and_crlf(self):
        ics = self._calendar()
        assert ics.startswith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")
        assert ics.endswith("END:VCALENDAR\r\n")
        # Keine nackten LF.
        assert "\n" not in ics.replace("\r\n", "")
        lines = _unfold(ics).split("\r\n")
        assert "METHOD:PUBLISH" in lines
        assert "CALSCALE:GREGORIAN" in lines
        assert "X-WR-CALNAME:Plane – NYA" in lines
        assert "REFRESH-INTERVAL;VALUE=DURATION:PT1H" in lines
        assert "X-PUBLISHED-TTL:PT1H" in lines
        assert lines.count("BEGIN:VEVENT") == lines.count("END:VEVENT") == 1

    def test_all_day_dtend_is_exclusive(self):
        lines = _unfold(self._calendar()).split("\r\n")
        assert "DTSTART;VALUE=DATE:20260330" in lines
        # Fällig am 31.03. → DTEND ist der 01.04.
        assert "DTEND;VALUE=DATE:20260401" in lines

    def test_single_day_and_swapped_dates(self):
        event = AllDayEvent(uid="x@plane", summary="x", start=date(2026, 12, 31), end=date(2026, 12, 30))
        lines = event.to_lines(datetime(2026, 1, 1, tzinfo=timezone.utc))
        assert "DTSTART;VALUE=DATE:20261230" in lines
        assert "DTEND;VALUE=DATE:20270101" in lines

    def test_text_escaped_but_url_not(self):
        lines = _unfold(self._calendar()).split("\r\n")
        assert "SUMMARY:[NYA-1] Bericht\\; Teil 1\\, Entwurf" in lines
        assert "CATEGORIES:In Arbeit\\, bald fertig" in lines
        assert "URL:https://plane.example.test/ws/browse/NYA-1/" in lines

    def test_timestamps_utc(self):
        lines = _unfold(self._calendar()).split("\r\n")
        assert "DTSTAMP:20260302T083000Z" in lines
        assert "LAST-MODIFIED:20260301T120000Z" in lines

    def test_invalid_status_dropped(self):
        event = AllDayEvent(uid="x@plane", summary="x", start=date(2026, 1, 1), end=date(2026, 1, 1), status="DONE")
        assert not any(line.startswith("STATUS") for line in event.to_lines(datetime.now(timezone.utc)))

    def test_outlook_free_busy(self):
        lines = _unfold(self._calendar()).split("\r\n")
        assert "TRANSP:TRANSPARENT" in lines
        assert "X-MICROSOFT-CDO-BUSYSTATUS:FREE" in lines


@pytest.mark.unit
class TestTokenHashing:
    def test_hash_is_sha256_hex(self):
        assert hash_token("abc") == hashlib.sha256(b"abc").hexdigest()
        assert re.fullmatch(r"[0-9a-f]{64}", hash_token("abc"))

    def test_generated_tokens_are_long_random_urlsafe(self):
        tokens = {generate_token() for _ in range(50)}
        assert len(tokens) == 50
        for token in tokens:
            assert len(token) >= 43
            assert re.fullmatch(r"[A-Za-z0-9_-]+", token)

    def test_set_new_token_stores_only_hash(self):
        feed = CalendarFeed()
        token = feed.set_new_token()
        assert feed.token_hash == hash_token(token)
        assert token not in feed.token_hash
        assert feed.token_prefix == token[:6]
