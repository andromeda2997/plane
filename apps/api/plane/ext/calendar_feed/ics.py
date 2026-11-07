# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Minimaler iCalendar-Erzeuger (RFC 5545) für Ganztagstermine.

Bewusst ohne Fremdbibliothek: ``apps/api/requirements`` enthält keine
iCalendar-Bibliothek, und der Feed braucht nur einen kleinen, gut testbaren
Ausschnitt (VCALENDAR + VEVENT mit DATE-Werten).
"""

import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone as dt_timezone
from typing import Iterable, Optional

CRLF = "\r\n"
# RFC 5545 3.1: Zeilen SOLLTEN nicht länger als 75 Oktette sein (ohne CRLF).
MAX_LINE_OCTETS = 75

# Steuerzeichen außer HTAB sind in TEXT-Werten nicht erlaubt (RFC 5545 3.3.11).
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")

ALLOWED_EVENT_STATUS = {"TENTATIVE", "CONFIRMED", "CANCELLED"}


def escape_text(value: Optional[str]) -> str:
    """TEXT-Wert escapen: Backslash zuerst, dann ``;``, ``,`` und Zeilenumbrüche."""
    if value is None:
        return ""
    text = str(value).replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
    text = text.replace("\n", "\\n")
    return _CONTROL_CHARS.sub("", text)


def fold_line(line: str) -> str:
    """Eine Inhaltszeile nach 75 Oktetten (UTF-8) falten.

    Fortsetzungszeilen beginnen mit einem Leerzeichen, das mitzählt. Mehrbyte-
    Zeichen werden nie zerteilt.
    """
    if len(line.encode("utf-8")) <= MAX_LINE_OCTETS:
        return line

    parts = []
    current = []
    current_octets = 0
    limit = MAX_LINE_OCTETS
    for char in line:
        char_octets = len(char.encode("utf-8"))
        if current_octets + char_octets > limit:
            parts.append("".join(current))
            current = []
            current_octets = 0
            # Ab der zweiten Zeile belegt das führende Leerzeichen ein Oktett.
            limit = MAX_LINE_OCTETS - 1
        current.append(char)
        current_octets += char_octets
    if current:
        parts.append("".join(current))
    return (CRLF + " ").join(parts)


def format_date(value: date) -> str:
    return value.strftime("%Y%m%d")


def format_datetime_utc(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=dt_timezone.utc)
    return value.astimezone(dt_timezone.utc).strftime("%Y%m%dT%H%M%SZ")


@dataclass
class AllDayEvent:
    uid: str
    summary: str
    start: date
    # Letzter Tag (inklusive); DTEND wird daraus exklusiv berechnet.
    end: date
    url: Optional[str] = None
    status: Optional[str] = None
    categories: list = field(default_factory=list)
    last_modified: Optional[datetime] = None
    created: Optional[datetime] = None

    def to_lines(self, dtstamp: datetime) -> list:
        start, end = self.start, self.end
        if end < start:
            start, end = end, start
        lines = [
            "BEGIN:VEVENT",
            f"UID:{escape_text(self.uid)}",
            f"DTSTAMP:{format_datetime_utc(dtstamp)}",
            f"DTSTART;VALUE=DATE:{format_date(start)}",
            # DTEND ist bei DATE-Werten exklusiv: Tag nach dem letzten Tag.
            f"DTEND;VALUE=DATE:{format_date(end + timedelta(days=1))}",
            f"SUMMARY:{escape_text(self.summary)}",
        ]
        if self.url:
            # URL ist vom Typ URI und wird nicht TEXT-escaped.
            lines.append(f"URL:{_CONTROL_CHARS.sub('', self.url)}")
        if self.status:
            status = self.status.upper()
            if status in ALLOWED_EVENT_STATUS:
                lines.append(f"STATUS:{status}")
        categories = [escape_text(category) for category in self.categories if category]
        if categories:
            lines.append(f"CATEGORIES:{','.join(categories)}")
        if self.created:
            lines.append(f"CREATED:{format_datetime_utc(self.created)}")
        if self.last_modified:
            lines.append(f"LAST-MODIFIED:{format_datetime_utc(self.last_modified)}")
        lines.extend(
            [
                # Ganztägige Aufgaben sollen in Outlook/Teams nicht als „beschäftigt“ zählen.
                "TRANSP:TRANSPARENT",
                "X-MICROSOFT-CDO-BUSYSTATUS:FREE",
                "X-MICROSOFT-CDO-ALLDAYEVENT:TRUE",
                "END:VEVENT",
            ]
        )
        return lines


def build_calendar(
    *,
    name: str,
    events: Iterable[AllDayEvent],
    description: Optional[str] = None,
    refresh_interval: str = "PT1H",
    dtstamp: Optional[datetime] = None,
) -> str:
    """Vollständiges VCALENDAR-Objekt als String mit CRLF-Zeilenenden."""
    dtstamp = dtstamp or datetime.now(dt_timezone.utc)
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Plane Fork//Kalender-Feed//DE",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{escape_text(name)}",
        f"NAME:{escape_text(name)}",
    ]
    if description:
        lines.append(f"X-WR-CALDESC:{escape_text(description)}")
    lines.extend(
        [
            f"REFRESH-INTERVAL;VALUE=DURATION:{refresh_interval}",
            f"X-PUBLISHED-TTL:{refresh_interval}",
        ]
    )
    for event in events:
        lines.extend(event.to_lines(dtstamp))
    lines.append("END:VCALENDAR")
    return CRLF.join(fold_line(line) for line in lines) + CRLF
