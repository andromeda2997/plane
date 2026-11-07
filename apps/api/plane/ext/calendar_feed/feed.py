# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Inhalt eines Kalender-Feeds zusammenstellen.

Datenschutz: es werden ausschließlich Titel, Kennung, Datum, Status und Link
ausgegeben – keine Beschreibungen, Kommentare oder Personen. Die Abfragen holen
deshalb nur die benötigten Spalten (``values()``).
"""

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional
from urllib.parse import quote

import pytz
from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from plane.db.models import Cycle, Issue, Module, Project, ProjectMember, WorkspaceMember
from plane.db.models.state import StateGroup

from .ics import AllDayEvent, build_calendar
from .models import CalendarFeed, CalendarFeedScope

GUEST_ROLE = 5
# Ältere Termine interessieren im Kalender nicht und machen Outlook langsam.
PAST_WINDOW_DAYS = 365
MAX_EVENTS = 2000
REFRESH_INTERVAL = "PT1H"

CLOSED_STATE_GROUPS = (StateGroup.COMPLETED.value, StateGroup.CANCELLED.value)
CLOSED_MODULE_STATUSES = ("completed", "cancelled")
# Gleiche Intake-Regel wie IssueViewSet: ausstehende/zurückgestellte Intake-Einträge ausblenden.
VISIBLE_INTAKE_FILTER = Q(issue_intake__status__in=[1, -1, 2]) | Q(issue_intake__isnull=True)

LABELS = {
    "de": {
        "cycle": "Zyklus",
        "module": "Modul",
        "my_work_items": "Meine Arbeitselemente",
        "description": "Termine aus Plane (nur Titel, Datum, Status und Link)",
    },
    "en": {
        "cycle": "Cycle",
        "module": "Module",
        "my_work_items": "My work items",
        "description": "Dates from Plane (title, date, status and link only)",
    },
}


class FeedNotAvailable(Exception):
    """Feed existiert nicht (mehr) oder der Besitzer darf ihn nicht mehr sehen → 404."""


@dataclass
class FeedContext:
    feed: CalendarFeed
    language: str
    web_url: str
    hide_completed: bool

    @property
    def labels(self) -> dict:
        return LABELS.get(self.language, LABELS["en"])


def get_web_url() -> str:
    web_url = getattr(settings, "WEB_URL", None) or getattr(settings, "APP_BASE_URL", None) or ""
    return web_url.rstrip("/")


def _user_language(user) -> str:
    profile = getattr(user, "profile", None)
    language = (getattr(profile, "language", None) or "en").split("-")[0].lower()
    return language if language in LABELS else "en"


def _window_start() -> date:
    return timezone.now().date() - timedelta(days=PAST_WINDOW_DAYS)


def check_feed_access(feed: CalendarFeed) -> None:
    """Prüft bei jedem Abruf, ob der Besitzer den Bereich (noch) sehen darf."""
    user = feed.user
    if not feed.is_active or not user.is_active or getattr(user, "is_bot", False):
        raise FeedNotAvailable()
    if feed.workspace.deleted_at is not None:
        raise FeedNotAvailable()
    if not WorkspaceMember.objects.filter(workspace_id=feed.workspace_id, member=user, is_active=True).exists():
        raise FeedNotAvailable()
    if feed.scope == CalendarFeedScope.PROJECT:
        project = feed.project
        if project is None or project.deleted_at is not None or project.archived_at is not None:
            raise FeedNotAvailable()
        if not ProjectMember.objects.filter(project_id=project.id, member=user, is_active=True).exists():
            raise FeedNotAvailable()


def _restricted_guest_project_ids(user, workspace_id) -> set:
    """Projekte, in denen der Nutzer Gast ist und nur eigene Arbeitselemente sehen darf."""
    return set(
        ProjectMember.objects.filter(
            workspace_id=workspace_id,
            member=user,
            is_active=True,
            role=GUEST_ROLE,
            project__guest_view_all_features=False,
        ).values_list("project_id", flat=True)
    )


def _issue_queryset(ctx: FeedContext):
    feed = ctx.feed
    user = feed.user
    window_start = _window_start()
    queryset = (
        Issue.issue_objects.filter(workspace_id=feed.workspace_id)
        .filter(project__deleted_at__isnull=True, state__deleted_at__isnull=True)
        .filter(Q(start_date__isnull=False) | Q(target_date__isnull=False))
        # Termin endet nicht vor dem Zeitfenster.
        .filter(
            Q(target_date__gte=window_start) | Q(target_date__isnull=True, start_date__gte=window_start),
        )
        .filter(VISIBLE_INTAKE_FILTER)
    )

    restricted = _restricted_guest_project_ids(user, feed.workspace_id)

    if feed.scope == CalendarFeedScope.PROJECT:
        queryset = queryset.filter(project_id=feed.project_id)
        if feed.project_id in restricted:
            queryset = queryset.filter(created_by=user)
    else:
        member_project_ids = ProjectMember.objects.filter(
            workspace_id=feed.workspace_id,
            member=user,
            is_active=True,
            project__archived_at__isnull=True,
        ).values_list("project_id", flat=True)
        queryset = queryset.filter(
            project_id__in=member_project_ids,
            # Die Zuweisungs-Tabelle wird soft-gelöscht: entfernte Zuweisungen ausschließen.
            issue_assignee__assignee=user,
            issue_assignee__deleted_at__isnull=True,
        )
        if restricted:
            queryset = queryset.filter(~Q(project_id__in=restricted) | Q(created_by=user))

    if ctx.hide_completed:
        queryset = queryset.exclude(state__group__in=CLOSED_STATE_GROUPS)

    return (
        queryset.values(
            "id",
            "name",
            "sequence_id",
            "start_date",
            "target_date",
            "created_at",
            "updated_at",
            "project_id",
            "project__identifier",
            "state__name",
            "state__group",
        )
        .distinct()
        .order_by("-target_date", "-start_date", "-sequence_id")
    )


def _issue_events(ctx: FeedContext) -> list:
    slug = quote(ctx.feed.workspace.slug)
    events = []
    for row in _issue_queryset(ctx)[:MAX_EVENTS]:
        identifier = f"{row['project__identifier']}-{row['sequence_id']}"
        start = row["start_date"] or row["target_date"]
        end = row["target_date"] or row["start_date"]
        state_group = row["state__group"]
        events.append(
            AllDayEvent(
                uid=f"{row['id']}@plane",
                summary=f"[{identifier}] {row['name']}",
                start=start,
                end=end,
                url=f"{ctx.web_url}/{slug}/browse/{quote(identifier)}/" if ctx.web_url else None,
                status="CANCELLED" if state_group == StateGroup.CANCELLED.value else "CONFIRMED",
                categories=[row["state__name"]] if row["state__name"] else [],
                created=row["created_at"],
                last_modified=row["updated_at"],
            )
        )
    return events


def _local_date(value, tz_name: Optional[str]) -> date:
    """Zyklus-Daten sind UTC-Zeitpunkte (lokale Mitternacht/23:59 des Projekts)."""
    try:
        tz = pytz.timezone(tz_name or "UTC")
    except pytz.UnknownTimeZoneError:
        tz = pytz.UTC
    return value.astimezone(tz).date()


def _project_feature_events(ctx: FeedContext, project: Project) -> list:
    """Zyklen und Module eines Projekts (nur für Projekt-Feeds)."""
    feed = ctx.feed
    if project.id in _restricted_guest_project_ids(feed.user, feed.workspace_id):
        return []

    slug = quote(feed.workspace.slug)
    base = f"{ctx.web_url}/{slug}/projects/{project.id}" if ctx.web_url else None
    today = timezone.now().date()
    window_start = _window_start()
    events = []

    if project.cycle_view:
        cycles = Cycle.objects.filter(
            project_id=project.id,
            archived_at__isnull=True,
            start_date__isnull=False,
            end_date__isnull=False,
        ).values("id", "name", "start_date", "end_date", "created_at", "updated_at")
        for row in cycles:
            start = _local_date(row["start_date"], project.timezone)
            end = _local_date(row["end_date"], project.timezone)
            if max(start, end) < window_start:
                continue
            if ctx.hide_completed and max(start, end) < today:
                continue
            events.append(
                AllDayEvent(
                    uid=f"cycle-{row['id']}@plane",
                    summary=f"[{project.identifier}] {ctx.labels['cycle']}: {row['name']}",
                    start=start,
                    end=end,
                    url=f"{base}/cycles/{row['id']}" if base else None,
                    status="CONFIRMED",
                    categories=[ctx.labels["cycle"]],
                    created=row["created_at"],
                    last_modified=row["updated_at"],
                )
            )

    if project.module_view:
        modules = Module.objects.filter(
            project_id=project.id,
            archived_at__isnull=True,
            target_date__isnull=False,
            target_date__gte=window_start,
        )
        if ctx.hide_completed:
            modules = modules.exclude(status__in=CLOSED_MODULE_STATUSES)
        for row in modules.values("id", "name", "start_date", "target_date", "status", "created_at", "updated_at"):
            events.append(
                AllDayEvent(
                    uid=f"module-{row['id']}@plane",
                    summary=f"[{project.identifier}] {ctx.labels['module']}: {row['name']}",
                    start=row["start_date"] or row["target_date"],
                    end=row["target_date"],
                    url=f"{base}/modules/{row['id']}" if base else None,
                    status="CANCELLED" if row["status"] == "cancelled" else "CONFIRMED",
                    categories=[ctx.labels["module"]],
                    created=row["created_at"],
                    last_modified=row["updated_at"],
                )
            )
    return events


def calendar_name(feed: CalendarFeed, language: str) -> str:
    labels = LABELS.get(language, LABELS["en"])
    if feed.scope == CalendarFeedScope.PROJECT and feed.project is not None:
        return f"Plane – {feed.project.identifier}"
    return f"Plane – {labels['my_work_items']} ({feed.workspace.name})"


def render_feed(feed: CalendarFeed, hide_completed: Optional[bool] = None) -> str:
    """Prüft die Berechtigung und gibt den Feed als iCalendar-Text zurück."""
    check_feed_access(feed)
    language = _user_language(feed.user)
    ctx = FeedContext(
        feed=feed,
        language=language,
        web_url=get_web_url(),
        hide_completed=feed.hide_completed if hide_completed is None else hide_completed,
    )
    events = _issue_events(ctx)
    if feed.scope == CalendarFeedScope.PROJECT:
        events.extend(_project_feature_events(ctx, feed.project))
    return build_calendar(
        name=calendar_name(feed, language),
        description=ctx.labels["description"],
        events=events,
        refresh_interval=REFRESH_INTERVAL,
    )
