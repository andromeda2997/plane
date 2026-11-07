# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import logging
from datetime import datetime, time, timedelta
from uuid import uuid4

import pytest
import pytz
from django.core.cache import cache
from django.urls import resolve
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import (
    Cycle,
    Issue,
    IssueAssignee,
    Module,
    Profile,
    Project,
    ProjectMember,
    State,
    User,
    WorkspaceMember,
)
from plane.ext.calendar_feed import feed as feed_module
from plane.ext.calendar_feed import views as feed_views
from plane.ext.calendar_feed.models import CalendarFeed, hash_token
from plane.ext.calendar_feed.throttles import CalendarFeedTokenThrottle
from plane.ext.milestones.models import Milestone, MilestoneIssue

WEB_URL = "https://plane.example.test"
TODAY = timezone.now().date()


def _unfold(text: str) -> str:
    return text.replace("\r\n ", "")


def _lines(response) -> list:
    return _unfold(response.content.decode("utf-8")).split("\r\n")


def _token_from_url(url: str) -> str:
    return url.rsplit("/", 1)[1].removesuffix(".ics")


@pytest.fixture(autouse=True)
def _settings(settings):
    settings.WEB_URL = WEB_URL
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(
        name="Nyanza",
        identifier="NYA",
        workspace=workspace,
        created_by=create_user,
        cycle_view=True,
        module_view=True,
        timezone="Europe/Berlin",
    )
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    return project


@pytest.fixture
def states(project):
    return {
        "todo": State.objects.create(name="Zu erledigen", project=project, group="unstarted", default=True),
        "done": State.objects.create(name="Erledigt", project=project, group="completed"),
        "cancelled": State.objects.create(name="Abgebrochen", project=project, group="cancelled"),
    }


def _issue(project, state, name, start=None, target=None, created_by=None, **extra):
    issue = Issue.objects.create(
        name=name,
        project=project,
        workspace=project.workspace,
        state=state,
        start_date=start,
        target_date=target,
        **extra,
    )
    if created_by is not None:
        # BaseModel.save() überschreibt created_by mit dem (hier fehlenden) Request-Nutzer.
        Issue.all_objects.filter(pk=issue.pk).update(created_by=created_by)
        issue.created_by = created_by
    return issue


@pytest.fixture
def other_user(db, workspace):
    uid = uuid4().hex[:8]
    user = User.objects.create(email=f"other-{uid}@plane.so", username=f"other_{uid}", first_name="Olga")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
    return user


def _milestone(project, name, day, issues=()):
    milestone = Milestone.objects.create(name=name, date=day, project=project, workspace=project.workspace)
    for issue in issues:
        MilestoneIssue.objects.create(milestone=milestone, issue=issue, project=project, workspace=project.workspace)
    return milestone


def _create_feed(client, slug, **data):
    response = client.post(f"/api/workspaces/{slug}/calendar-feeds/", data, format="json")
    assert response.status_code == status.HTTP_201_CREATED, response.content
    return response


def _fetch(token, **params):
    return APIClient().get(f"/api/calendar-feeds/{token}.ics", params)


@pytest.mark.contract
class TestRouting:
    def test_routes_reach_extension_views(self):
        token = "A" * 43
        assert resolve(f"/api/calendar-feeds/{token}.ics").func.view_class is feed_views.PublicCalendarFeedEndpoint
        assert resolve("/api/users/me/calendar-feeds/").func.view_class is feed_views.UserCalendarFeedsEndpoint
        assert (
            resolve("/api/workspaces/ws/calendar-feeds/").func.view_class is feed_views.WorkspaceCalendarFeedsEndpoint
        )
        pk = uuid4()
        assert (
            resolve(f"/api/workspaces/ws/calendar-feeds/{pk}/").func.view_class
            is feed_views.WorkspaceCalendarFeedDetailEndpoint
        )
        assert (
            resolve(f"/api/workspaces/ws/calendar-feeds/{pk}/regenerate/").func.view_class
            is feed_views.WorkspaceCalendarFeedRegenerateEndpoint
        )


@pytest.mark.contract
class TestManagementApi:
    def test_create_returns_url_once_and_stores_hash(self, session_client, workspace, project):
        response = _create_feed(session_client, workspace.slug, scope="project", project_id=str(project.id))
        url = response.data["url"]
        assert url.startswith(f"{WEB_URL}/api/calendar-feeds/") and url.endswith(".ics")
        token = _token_from_url(url)
        feed = CalendarFeed.objects.get(pk=response.data["id"])
        assert feed.token_hash == hash_token(token)
        assert token not in feed.token_hash
        assert "token_hash" not in response.data

        listing = session_client.get(f"/api/workspaces/{workspace.slug}/calendar-feeds/")
        assert listing.status_code == 200
        assert len(listing.data) == 1
        item = listing.data[0]
        assert "url" not in item and "token_hash" not in item and "token" not in item
        assert token not in str(listing.content)
        assert item["project_identifier"] == "NYA"

        user_listing = session_client.get("/api/users/me/calendar-feeds/")
        assert [row["id"] for row in user_listing.data] == [item["id"]]

    def test_create_project_feed_requires_membership(self, session_client, workspace, create_user):
        foreign = Project.objects.create(name="Fremd", identifier="FRE", workspace=workspace)
        response = session_client.post(
            f"/api/workspaces/{workspace.slug}/calendar-feeds/",
            {"scope": "project", "project_id": str(foreign.id)},
            format="json",
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert not CalendarFeed.objects.exists()

    def test_create_requires_workspace_membership(self, db, other_user, workspace):
        WorkspaceMember.objects.filter(member=other_user).update(is_active=False)
        client = APIClient()
        client.force_authenticate(user=other_user)
        response = client.post(
            f"/api/workspaces/{workspace.slug}/calendar-feeds/", {"scope": "my_work_items"}, format="json"
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_project_scope_needs_project_id(self, session_client, workspace):
        response = session_client.post(
            f"/api/workspaces/{workspace.slug}/calendar-feeds/", {"scope": "project"}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_revoke_and_regenerate(self, session_client, workspace, project, states):
        _issue(project, states["todo"], "Termin", target=TODAY)
        response = _create_feed(session_client, workspace.slug, scope="project", project_id=str(project.id))
        feed_id = response.data["id"]
        old_token = _token_from_url(response.data["url"])
        assert _fetch(old_token).status_code == 200

        regenerated = session_client.post(f"/api/workspaces/{workspace.slug}/calendar-feeds/{feed_id}/regenerate/")
        assert regenerated.status_code == 200
        new_token = _token_from_url(regenerated.data["url"])
        assert new_token != old_token
        assert regenerated.data["id"] == feed_id
        assert _fetch(old_token).status_code == 404
        assert _fetch(new_token).status_code == 200

        revoked = session_client.delete(f"/api/workspaces/{workspace.slug}/calendar-feeds/{feed_id}/")
        assert revoked.status_code == status.HTTP_204_NO_CONTENT
        assert CalendarFeed.objects.get(pk=feed_id).revoked_at is not None
        assert _fetch(new_token).status_code == 404
        # Widerrufene Feeds tauchen nicht mehr auf und lassen sich nicht neu erzeugen.
        assert session_client.get(f"/api/workspaces/{workspace.slug}/calendar-feeds/").data == []
        again = session_client.post(f"/api/workspaces/{workspace.slug}/calendar-feeds/{feed_id}/regenerate/")
        assert again.status_code == 404

    def test_cannot_touch_other_users_feed(self, session_client, workspace, other_user):
        client = APIClient()
        client.force_authenticate(user=other_user)
        response = _create_feed(client, workspace.slug, scope="my_work_items")
        feed_id = response.data["id"]

        assert session_client.delete(f"/api/workspaces/{workspace.slug}/calendar-feeds/{feed_id}/").status_code == 404
        assert (
            session_client.post(f"/api/workspaces/{workspace.slug}/calendar-feeds/{feed_id}/regenerate/").status_code
            == 404
        )
        assert session_client.get(f"/api/workspaces/{workspace.slug}/calendar-feeds/").data == []
        assert CalendarFeed.objects.get(pk=feed_id).revoked_at is None


@pytest.mark.contract
class TestPublicFeed:
    def test_project_feed_content(self, session_client, workspace, project, states, create_user):
        issue = _issue(
            project,
            states["todo"],
            "Bericht; Teil 1, Entwurf",
            start=TODAY,
            target=TODAY + timedelta(days=2),
            description_html="<p>GEHEIME BESCHREIBUNG</p>",
        )
        IssueAssignee.objects.create(issue=issue, assignee=create_user, project=project)
        _issue(project, states["todo"], "Ohne Datum")
        due_only = _issue(project, states["todo"], "Nur fällig", target=TODAY + timedelta(days=5))

        response = _create_feed(session_client, workspace.slug, scope="project", project_id=str(project.id))
        fetched = _fetch(_token_from_url(response.data["url"]))

        assert fetched.status_code == 200
        assert fetched["Content-Type"] == "text/calendar; charset=utf-8"
        assert "no-store" in fetched["Cache-Control"] and "private" in fetched["Cache-Control"]
        body = fetched.content.decode("utf-8")
        assert body.startswith("BEGIN:VCALENDAR\r\n")
        lines = _lines(fetched)
        assert "X-WR-CALNAME:Plane – NYA" in lines
        assert "REFRESH-INTERVAL;VALUE=DURATION:PT1H" in lines

        assert f"UID:{issue.id}@plane" in lines
        assert f"SUMMARY:[NYA-{issue.sequence_id}] Bericht\\; Teil 1\\, Entwurf" in lines
        assert f"DTSTART;VALUE=DATE:{TODAY:%Y%m%d}" in lines
        assert f"DTEND;VALUE=DATE:{TODAY + timedelta(days=3):%Y%m%d}" in lines
        assert f"URL:{WEB_URL}/{workspace.slug}/browse/NYA-{issue.sequence_id}/" in lines
        assert "CATEGORIES:Zu erledigen" in lines
        assert "STATUS:CONFIRMED" in lines

        # Nur Fälligkeitsdatum → eintägiger Termin am Fälligkeitstag.
        due = TODAY + timedelta(days=5)
        assert f"UID:{due_only.id}@plane" in lines
        assert f"DTSTART;VALUE=DATE:{due:%Y%m%d}" in lines
        assert f"DTEND;VALUE=DATE:{due + timedelta(days=1):%Y%m%d}" in lines

        assert "Ohne Datum" not in body
        # Datenschutz: keine Beschreibung, keine Personen.
        assert "GEHEIME" not in body
        assert create_user.email not in body
        assert "DESCRIPTION" not in body
        assert "ATTENDEE" not in body and "ORGANIZER" not in body

        feed = CalendarFeed.objects.get(pk=response.data["id"])
        assert feed.last_used_at is not None

    @pytest.mark.parametrize("accept", ["text/calendar", "text/calendar, */*;q=0.1", "*/*"])
    def test_calendar_accept_header_and_head(self, session_client, workspace, project, accept):
        response = _create_feed(session_client, workspace.slug, scope="project", project_id=str(project.id))
        token = _token_from_url(response.data["url"])
        fetched = APIClient().get(f"/api/calendar-feeds/{token}.ics", HTTP_ACCEPT=accept)
        assert fetched.status_code == 200
        assert fetched["Content-Type"] == "text/calendar; charset=utf-8"
        assert APIClient().head(f"/api/calendar-feeds/{token}.ics", HTTP_ACCEPT=accept).status_code == 200

    def test_unknown_token_404(self, db):
        response = _fetch("x" * 43)
        assert response.status_code == 404
        assert "no-store" in response["Cache-Control"]

    def test_hide_completed(self, session_client, workspace, project, states):
        open_issue = _issue(project, states["todo"], "Offen", target=TODAY)
        done = _issue(project, states["done"], "Fertig", target=TODAY)
        cancelled = _issue(project, states["cancelled"], "Abgesagt", target=TODAY)

        response = _create_feed(session_client, workspace.slug, scope="project", project_id=str(project.id))
        token = _token_from_url(response.data["url"])

        all_lines = _lines(_fetch(token))
        assert f"UID:{done.id}@plane" in all_lines
        assert f"UID:{cancelled.id}@plane" in all_lines
        assert "STATUS:CANCELLED" in all_lines

        hidden = _lines(_fetch(token, hide_completed="true"))
        assert f"UID:{open_issue.id}@plane" in hidden
        assert f"UID:{done.id}@plane" not in hidden
        assert f"UID:{cancelled.id}@plane" not in hidden

        # Als Feed-Einstellung gespeichert, per Parameter übersteuerbar.
        stored = _create_feed(
            session_client, workspace.slug, scope="project", project_id=str(project.id), hide_completed=True
        )
        stored_token = _token_from_url(stored.data["url"])
        assert f"UID:{done.id}@plane" not in _lines(_fetch(stored_token))
        assert f"UID:{done.id}@plane" in _lines(_fetch(stored_token, hide_completed="0"))

    def test_archived_deleted_draft_hidden(self, session_client, workspace, project, states):
        visible = _issue(project, states["todo"], "Sichtbar", target=TODAY)
        archived = _issue(project, states["todo"], "Archiviert", target=TODAY)
        Issue.objects.filter(pk=archived.pk).update(archived_at=TODAY)
        deleted = _issue(project, states["todo"], "Gelöscht", target=TODAY)
        Issue.objects.filter(pk=deleted.pk).update(deleted_at=timezone.now())
        draft = _issue(project, states["todo"], "Entwurf", target=TODAY, is_draft=True)

        response = _create_feed(session_client, workspace.slug, scope="project", project_id=str(project.id))
        lines = _lines(_fetch(_token_from_url(response.data["url"])))
        assert f"UID:{visible.id}@plane" in lines
        for hidden in (archived, deleted, draft):
            assert f"UID:{hidden.id}@plane" not in lines

    def test_cycles_and_modules(self, session_client, workspace, project, states, create_user):
        berlin = pytz.timezone("Europe/Berlin")
        start_day = TODAY + timedelta(days=1)
        end_day = TODAY + timedelta(days=14)
        # So speichert Plane Zyklen: lokale Mitternacht bzw. 23:59 des Projekts in UTC.
        cycle = Cycle.objects.create(
            name="Sprint 7",
            project=project,
            workspace=workspace,
            owned_by=create_user,
            start_date=berlin.localize(datetime.combine(start_day, time.min)).astimezone(pytz.UTC),
            end_date=berlin.localize(datetime.combine(end_day, time(23, 59))).astimezone(pytz.UTC),
        )
        Cycle.objects.create(name="Ohne Datum", project=project, workspace=workspace, owned_by=create_user)
        module = Module.objects.create(
            name="Release 2",
            project=project,
            workspace=workspace,
            target_date=TODAY + timedelta(days=30),
        )
        archived_module = Module.objects.create(
            name="Alt",
            project=project,
            workspace=workspace,
            target_date=TODAY,
            archived_at=timezone.now(),
        )

        response = _create_feed(session_client, workspace.slug, scope="project", project_id=str(project.id))
        lines = _lines(_fetch(_token_from_url(response.data["url"])))

        assert f"UID:cycle-{cycle.id}@plane" in lines
        assert f"DTSTART;VALUE=DATE:{start_day:%Y%m%d}" in lines
        assert f"DTEND;VALUE=DATE:{end_day + timedelta(days=1):%Y%m%d}" in lines
        assert f"URL:{WEB_URL}/{workspace.slug}/projects/{project.id}/cycles/{cycle.id}" in lines
        assert f"UID:module-{module.id}@plane" in lines
        assert f"URL:{WEB_URL}/{workspace.slug}/projects/{project.id}/modules/{module.id}" in lines
        assert f"UID:module-{archived_module.id}@plane" not in lines
        assert "Ohne Datum" not in "\n".join(lines)

        # Zyklen/Module abgeschaltet → nicht im Feed.
        Project.objects.filter(pk=project.pk).update(cycle_view=False, module_view=False)
        lines = _lines(_fetch(_token_from_url(response.data["url"])))
        assert not any(line.startswith("UID:cycle-") or line.startswith("UID:module-") for line in lines)


@pytest.mark.contract
class TestMilestonesInFeed:
    def test_milestone_event(self, session_client, workspace, project, states, create_user):
        day = TODAY + timedelta(days=10)
        milestone = _milestone(project, "LP 3 abgeschlossen", day)
        old = _milestone(project, "Uralt", TODAY - timedelta(days=feed_module.PAST_WINDOW_DAYS + 5))
        deleted = _milestone(project, "Gelöscht", day)
        Milestone.all_objects.filter(pk=deleted.pk).update(deleted_at=timezone.now())

        response = _create_feed(session_client, workspace.slug, scope="project", project_id=str(project.id))
        token = _token_from_url(response.data["url"])
        lines = _lines(_fetch(token))

        assert f"UID:milestone-{milestone.id}@plane" in lines
        start = lines.index(f"UID:milestone-{milestone.id}@plane")
        event = lines[start : lines.index("END:VEVENT", start)]
        assert f"DTSTART;VALUE=DATE:{day:%Y%m%d}" in event
        assert f"DTEND;VALUE=DATE:{day + timedelta(days=1):%Y%m%d}" in event
        assert "SUMMARY:[NYA] Milestone: LP 3 abgeschlossen" in event
        assert f"URL:{WEB_URL}/{workspace.slug}/projects/{project.id}/issues" in event
        assert "CATEGORIES:Milestone" in event
        assert "STATUS:CONFIRMED" in event
        assert f"UID:milestone-{old.id}@plane" not in lines
        assert f"UID:milestone-{deleted.id}@plane" not in lines

        # Bezeichnung nach Profilsprache wie bei Zyklus/Modul; unabhängig von Zyklen/Modulen.
        Profile.objects.update_or_create(user=create_user, defaults={"language": "de"})
        Project.objects.filter(pk=project.pk).update(cycle_view=False, module_view=False)
        lines = _lines(_fetch(token))
        assert "SUMMARY:[NYA] Meilenstein: LP 3 abgeschlossen" in lines
        assert "CATEGORIES:Meilenstein" in lines

    def test_hide_completed_milestones(self, session_client, workspace, project, states):
        day = TODAY + timedelta(days=3)
        empty = _milestone(project, "Ohne Elemente", day)
        closed = _milestone(
            project,
            "Alles erledigt",
            day,
            issues=[_issue(project, states["done"], "Fertig"), _issue(project, states["cancelled"], "Abgesagt")],
        )
        mixed = _milestone(
            project,
            "Teilweise",
            day,
            issues=[_issue(project, states["done"], "Fertig 2"), _issue(project, states["todo"], "Offen")],
        )
        # Entfernte Verknüpfung zu einem offenen Element zählt nicht mehr.
        unlinked_open = _issue(project, states["todo"], "Nicht mehr verknüpft")
        MilestoneIssue.objects.create(milestone=closed, issue=unlinked_open, project=project, workspace=workspace)
        MilestoneIssue.objects.filter(milestone=closed, issue=unlinked_open).delete()

        response = _create_feed(session_client, workspace.slug, scope="project", project_id=str(project.id))
        token = _token_from_url(response.data["url"])

        all_lines = _lines(_fetch(token))
        for milestone in (empty, closed, mixed):
            assert f"UID:milestone-{milestone.id}@plane" in all_lines

        hidden = _lines(_fetch(token, hide_completed="true"))
        assert f"UID:milestone-{empty.id}@plane" in hidden
        assert f"UID:milestone-{mixed.id}@plane" in hidden
        assert f"UID:milestone-{closed.id}@plane" not in hidden

    def test_restricted_guest_sees_no_milestones(self, workspace, project, states, other_user):
        ProjectMember.objects.create(project=project, member=other_user, role=5, is_active=True)
        milestone = _milestone(project, "Abgabe", TODAY)
        client = APIClient()
        client.force_authenticate(user=other_user)
        token = _token_from_url(
            _create_feed(client, workspace.slug, scope="project", project_id=str(project.id)).data["url"]
        )

        assert f"UID:milestone-{milestone.id}@plane" not in _lines(_fetch(token))
        Project.objects.filter(pk=project.pk).update(guest_view_all_features=True)
        assert f"UID:milestone-{milestone.id}@plane" in _lines(_fetch(token))

    def test_not_in_my_work_items_feed(self, session_client, workspace, project, states, create_user):
        issue = _issue(project, states["todo"], "Mir zugewiesen", target=TODAY)
        IssueAssignee.objects.create(issue=issue, assignee=create_user, project=project)
        _milestone(project, "Abgabe", TODAY, issues=[issue])

        response = _create_feed(session_client, workspace.slug, scope="my_work_items")
        lines = _lines(_fetch(_token_from_url(response.data["url"])))
        assert f"UID:{issue.id}@plane" in lines
        assert not any(line.startswith("UID:milestone-") for line in lines)

    def test_skipped_when_extension_not_installed(self, session_client, workspace, project, monkeypatch):
        milestone = _milestone(project, "Abgabe", TODAY)
        response = _create_feed(session_client, workspace.slug, scope="project", project_id=str(project.id))
        token = _token_from_url(response.data["url"])
        assert f"UID:milestone-{milestone.id}@plane" in _lines(_fetch(token))

        original = feed_module.apps.is_installed
        monkeypatch.setattr(
            feed_module.apps,
            "is_installed",
            lambda name: False if name == "plane.ext.milestones" else original(name),
        )
        fetched = _fetch(token)
        assert fetched.status_code == 200
        assert f"UID:milestone-{milestone.id}@plane" not in _lines(fetched)


@pytest.mark.contract
class TestPublicFeedPermissions:
    def _project_feed_token(self, user, workspace, project):
        client = APIClient()
        client.force_authenticate(user=user)
        response = _create_feed(client, workspace.slug, scope="project", project_id=str(project.id))
        return _token_from_url(response.data["url"])

    def test_removed_from_project_returns_404(self, workspace, project, states, other_user):
        ProjectMember.objects.create(project=project, member=other_user, role=15, is_active=True)
        _issue(project, states["todo"], "Termin", target=TODAY)
        token = self._project_feed_token(other_user, workspace, project)
        assert _fetch(token).status_code == 200

        ProjectMember.objects.filter(project=project, member=other_user).update(is_active=False)
        assert _fetch(token).status_code == 404

    def test_left_workspace_or_deactivated_returns_404(self, workspace, project, states, other_user):
        ProjectMember.objects.create(project=project, member=other_user, role=15, is_active=True)
        token = self._project_feed_token(other_user, workspace, project)
        assert _fetch(token).status_code == 200

        WorkspaceMember.objects.filter(member=other_user).update(is_active=False)
        assert _fetch(token).status_code == 404

        WorkspaceMember.objects.filter(member=other_user).update(is_active=True)
        assert _fetch(token).status_code == 200
        User.objects.filter(pk=other_user.pk).update(is_active=False)
        assert _fetch(token).status_code == 404

    def test_archived_project_returns_404(self, session_client, workspace, project):
        response = _create_feed(session_client, workspace.slug, scope="project", project_id=str(project.id))
        Project.objects.filter(pk=project.pk).update(archived_at=timezone.now())
        assert _fetch(_token_from_url(response.data["url"])).status_code == 404

    def test_guest_sees_only_own_items_and_no_cycles(self, workspace, project, states, other_user, create_user):
        ProjectMember.objects.create(project=project, member=other_user, role=5, is_active=True)
        own = _issue(project, states["todo"], "Vom Gast", target=TODAY, created_by=other_user)
        foreign = _issue(project, states["todo"], "Von Admin", target=TODAY, created_by=create_user)
        cycle = Cycle.objects.create(
            name="Sprint",
            project=project,
            workspace=workspace,
            owned_by=create_user,
            start_date=timezone.now(),
            end_date=timezone.now() + timedelta(days=7),
        )
        token = self._project_feed_token(other_user, workspace, project)

        lines = _lines(_fetch(token))
        assert f"UID:{own.id}@plane" in lines
        assert f"UID:{foreign.id}@plane" not in lines
        assert f"UID:cycle-{cycle.id}@plane" not in lines

        Project.objects.filter(pk=project.pk).update(guest_view_all_features=True)
        lines = _lines(_fetch(token))
        assert f"UID:{foreign.id}@plane" in lines
        assert f"UID:cycle-{cycle.id}@plane" in lines


@pytest.mark.contract
class TestMyWorkItemsFeed:
    def test_only_assigned_items_in_member_projects(self, session_client, workspace, project, states, create_user):
        assigned = _issue(project, states["todo"], "Mir zugewiesen", target=TODAY)
        IssueAssignee.objects.create(issue=assigned, assignee=create_user, project=project)
        unassigned = _issue(project, states["todo"], "Nicht zugewiesen", target=TODAY)
        removed = _issue(project, states["todo"], "Zuweisung entfernt", target=TODAY)
        IssueAssignee.objects.create(issue=removed, assignee=create_user, project=project)
        IssueAssignee.objects.filter(issue=removed).update(deleted_at=timezone.now())

        other_project = Project.objects.create(name="Andere", identifier="AND", workspace=workspace)
        other_state = State.objects.create(name="Offen", project=other_project, group="unstarted", default=True)
        not_member = _issue(other_project, other_state, "Kein Mitglied", target=TODAY)
        IssueAssignee.objects.create(issue=not_member, assignee=create_user, project=other_project)

        response = _create_feed(session_client, workspace.slug, scope="my_work_items")
        assert response.data["project"] is None
        fetched = _fetch(_token_from_url(response.data["url"]))
        assert fetched.status_code == 200
        lines = _lines(fetched)
        assert f"UID:{assigned.id}@plane" in lines
        for hidden in (unassigned, removed, not_member):
            assert f"UID:{hidden.id}@plane" not in lines
        assert any(line.startswith("X-WR-CALNAME:Plane – My work items") for line in lines)


@pytest.mark.contract
class TestAbuseProtection:
    def test_token_throttle(self, session_client, workspace, project, monkeypatch):
        monkeypatch.setattr(CalendarFeedTokenThrottle, "rate", "2/hour")
        response = _create_feed(session_client, workspace.slug, scope="project", project_id=str(project.id))
        token = _token_from_url(response.data["url"])
        assert _fetch(token).status_code == 200
        assert _fetch(token).status_code == 200
        assert _fetch(token).status_code == status.HTTP_429_TOO_MANY_REQUESTS

    def test_token_not_in_request_log(self, session_client, workspace, project):
        response = _create_feed(session_client, workspace.slug, scope="project", project_id=str(project.id))
        token = _token_from_url(response.data["url"])

        records = []

        class _ListHandler(logging.Handler):
            def emit(self, record):
                records.append(record)

        handler = _ListHandler(level=logging.INFO)
        request_logger = logging.getLogger("plane.api.request")
        previous_level = request_logger.level
        request_logger.addHandler(handler)
        request_logger.setLevel(logging.INFO)
        try:
            assert _fetch(token).status_code == 200
        finally:
            request_logger.removeHandler(handler)
            request_logger.setLevel(previous_level)
        messages = [record.getMessage() + " " + str(getattr(record, "path", "")) for record in records]
        assert any("calendar-feeds/[redacted].ics" in message for message in messages)
        assert not any(token in message for message in messages)
