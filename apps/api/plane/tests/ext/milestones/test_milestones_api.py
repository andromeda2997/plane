# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from uuid import uuid4

import pytest
from django.urls import resolve
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import Issue, Project, ProjectMember, State, User, WorkspaceMember
from plane.ext.milestones import views as milestone_views
from plane.ext.milestones.models import DEFAULT_MILESTONE_COLOR, Milestone, MilestoneIssue


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(
        name="Neubau Kita",
        identifier="KITA",
        workspace=workspace,
        created_by=create_user,
    )
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    return project


@pytest.fixture
def other_project(db, workspace, create_user):
    project = Project.objects.create(name="Umbau Rathaus", identifier="RAT", workspace=workspace)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    return project


@pytest.fixture
def states(project):
    return {
        "todo": State.objects.create(name="Offen", project=project, group="unstarted", default=True),
        "done": State.objects.create(name="Erledigt", project=project, group="completed"),
        "cancelled": State.objects.create(name="Abgebrochen", project=project, group="cancelled"),
    }


def _issue(project, state=None, name="Element", **extra):
    return Issue.objects.create(name=name, project=project, workspace=project.workspace, state=state, **extra)


def _member_client(workspace, project, role):
    uid = uuid4().hex[:8]
    user = User.objects.create(email=f"user-{uid}@plane.so", username=f"user_{uid}")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=role)
    ProjectMember.objects.create(project=project, member=user, role=role, is_active=True)
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _base(workspace, project):
    return f"/api/workspaces/{workspace.slug}/projects/{project.id}"


def _create(client, workspace, project, **data):
    payload = {"name": "LP 3 Entwurfsplanung", "date": "2026-12-15", **data}
    return client.post(f"{_base(workspace, project)}/milestones/", payload, format="json")


@pytest.mark.contract
class TestRouting:
    def test_routes_reach_extension_views(self):
        base = f"/api/workspaces/ws/projects/{uuid4()}"
        pk = uuid4()
        assert resolve(f"{base}/milestones/").func.view_class is milestone_views.MilestoneListEndpoint
        assert resolve(f"{base}/milestones/{pk}/").func.view_class is milestone_views.MilestoneDetailEndpoint
        assert resolve(f"{base}/milestones/{pk}/issues/").func.view_class is milestone_views.MilestoneIssuesEndpoint
        assert (
            resolve(f"{base}/milestones/{pk}/issues/{uuid4()}/").func.view_class
            is milestone_views.MilestoneIssueDetailEndpoint
        )
        assert resolve(f"{base}/issues/{pk}/milestones/").func.view_class is milestone_views.IssueMilestonesEndpoint


@pytest.mark.contract
class TestMilestoneCrud:
    def test_create_with_defaults(self, session_client, workspace, project):
        response = _create(session_client, workspace, project, name="  LP 3  ")
        assert response.status_code == status.HTTP_201_CREATED, response.content
        data = response.json()
        assert data["name"] == "LP 3"
        assert data["date"] == "2026-12-15"
        assert data["color"] == DEFAULT_MILESTONE_COLOR
        assert data["description"] == ""
        assert data["project"] == str(project.id)
        assert data["workspace"] == str(workspace.id)
        assert (data["total_issues"], data["completed_issues"], data["cancelled_issues"]) == (0, 0, 0)
        milestone = Milestone.objects.get(pk=data["id"])
        assert milestone.workspace_id == workspace.id

    @pytest.mark.parametrize(
        "payload",
        [
            {"color": "red"},
            {"color": "#12345"},
            {"name": "   "},
            {"date": "15.12.2026"},
            {"description": "x" * 2001},
        ],
    )
    def test_create_validation(self, session_client, workspace, project, payload):
        response = _create(session_client, workspace, project, **payload)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not Milestone.objects.exists()

    def test_create_requires_date(self, session_client, workspace, project):
        response = session_client.post(
            f"{_base(workspace, project)}/milestones/", {"name": "Ohne Datum"}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_color_is_normalized(self, session_client, workspace, project):
        response = _create(session_client, workspace, project, color="#ab12cd")
        assert response.json()["color"] == "#AB12CD"

    def test_list_is_sorted_by_date_and_scoped_to_project(self, session_client, workspace, project, other_project):
        _create(session_client, workspace, project, name="Später", date="2027-03-01")
        _create(session_client, workspace, project, name="Früher", date="2026-11-01")
        _create(session_client, workspace, other_project, name="Fremd")
        response = session_client.get(f"{_base(workspace, project)}/milestones/")
        assert response.status_code == status.HTTP_200_OK
        assert [m["name"] for m in response.json()] == ["Früher", "Später"]

    def test_update_date_and_fields(self, session_client, workspace, project):
        milestone_id = _create(session_client, workspace, project).json()["id"]
        response = session_client.patch(
            f"{_base(workspace, project)}/milestones/{milestone_id}/",
            {"date": "2027-01-10", "color": "#16A34A", "description": "Abgabe Bauantrag"},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK, response.content
        data = response.json()
        assert (data["date"], data["color"], data["description"]) == ("2027-01-10", "#16A34A", "Abgabe Bauantrag")
        assert data["name"] == "LP 3 Entwurfsplanung"

    def test_project_and_workspace_are_read_only(self, session_client, workspace, project, other_project):
        milestone_id = _create(session_client, workspace, project).json()["id"]
        session_client.patch(
            f"{_base(workspace, project)}/milestones/{milestone_id}/",
            {"project": str(other_project.id)},
            format="json",
        )
        assert Milestone.objects.get(pk=milestone_id).project_id == project.id

    def test_milestone_of_other_project_is_not_found(self, session_client, workspace, project, other_project):
        milestone_id = _create(session_client, workspace, other_project).json()["id"]
        url = f"{_base(workspace, project)}/milestones/{milestone_id}/"
        assert session_client.get(url).status_code == status.HTTP_404_NOT_FOUND
        assert session_client.patch(url, {"name": "x"}, format="json").status_code == status.HTTP_404_NOT_FOUND
        assert session_client.delete(url).status_code == status.HTTP_404_NOT_FOUND

    def test_delete_is_soft_and_removes_links(self, session_client, workspace, project, states):
        milestone_id = _create(session_client, workspace, project).json()["id"]
        issue = _issue(project, states["todo"])
        session_client.post(
            f"{_base(workspace, project)}/milestones/{milestone_id}/issues/",
            {"issue_ids": [str(issue.id)]},
            format="json",
        )
        response = session_client.delete(f"{_base(workspace, project)}/milestones/{milestone_id}/")
        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not Milestone.objects.filter(pk=milestone_id).exists()
        assert Milestone.all_objects.get(pk=milestone_id).deleted_at is not None
        assert not MilestoneIssue.objects.filter(milestone_id=milestone_id).exists()
        assert MilestoneIssue.all_objects.filter(milestone_id=milestone_id, deleted_at__isnull=False).count() == 1
        assert session_client.get(f"{_base(workspace, project)}/milestones/").json() == []
        issue_url = f"{_base(workspace, project)}/issues/{issue.id}/milestones/"
        assert session_client.get(issue_url).json() == {"milestone_ids": []}


@pytest.mark.contract
class TestProgressAndLinks:
    def test_progress_counts_by_state_group(self, session_client, workspace, project, states):
        milestone_id = _create(session_client, workspace, project).json()["id"]
        issues = [
            _issue(project, states["todo"], "offen"),
            _issue(project, states["done"], "erledigt 1"),
            _issue(project, states["done"], "erledigt 2"),
            _issue(project, states["cancelled"], "abgebrochen"),
        ]
        # zählen nicht: gelöscht, archiviert, Entwurf
        deleted = _issue(project, states["todo"], "gelöscht")
        archived = _issue(project, states["done"], "archiviert", archived_at=timezone.now())
        draft = _issue(project, states["todo"], "entwurf", is_draft=True)
        all_ids = [str(i.id) for i in [*issues, deleted, archived, draft]]
        response = session_client.post(
            f"{_base(workspace, project)}/milestones/{milestone_id}/issues/", {"issue_ids": all_ids}, format="json"
        )
        assert response.status_code == status.HTTP_200_OK, response.content
        Issue.objects.filter(pk=deleted.pk).delete()

        data = session_client.get(f"{_base(workspace, project)}/milestones/").json()[0]
        assert (data["total_issues"], data["completed_issues"], data["cancelled_issues"]) == (4, 2, 1)

    def test_progress_is_counted_per_milestone_with_shared_items(self, session_client, workspace, project, states):
        base = _base(workspace, project)
        a = _create(session_client, workspace, project, name="A", date="2026-12-01").json()["id"]
        b = _create(session_client, workspace, project, name="B", date="2026-12-02").json()["id"]
        shared = _issue(project, states["done"], "in A und B")
        only_a = _issue(project, states["todo"], "nur A")
        relinked = _issue(project, states["cancelled"], "neu verknüpft in B")
        session_client.post(
            f"{base}/milestones/{a}/issues/", {"issue_ids": [str(shared.id), str(only_a.id)]}, format="json"
        )
        session_client.post(
            f"{base}/milestones/{b}/issues/", {"issue_ids": [str(shared.id), str(relinked.id)]}, format="json"
        )
        # lösen und neu verknüpfen → eine soft-gelöschte und eine aktive Zeile
        session_client.delete(f"{base}/milestones/{b}/issues/{relinked.id}/")
        session_client.post(f"{base}/milestones/{b}/issues/", {"issue_ids": [str(relinked.id)]}, format="json")
        assert MilestoneIssue.all_objects.filter(milestone_id=b, issue=relinked).count() == 2

        data = {m["name"]: m for m in session_client.get(f"{base}/milestones/").json()}
        counts = lambda m: (m["total_issues"], m["completed_issues"], m["cancelled_issues"])  # noqa: E731
        assert counts(data["A"]) == (2, 1, 0)
        assert counts(data["B"]) == (2, 1, 1)

    def test_link_is_idempotent_and_can_be_removed_and_relinked(self, session_client, workspace, project, states):
        milestone_id = _create(session_client, workspace, project).json()["id"]
        issue = _issue(project, states["todo"])
        url = f"{_base(workspace, project)}/milestones/{milestone_id}/issues/"
        for _ in range(2):
            response = session_client.post(url, {"issue_ids": [str(issue.id)]}, format="json")
            assert response.json()["total_issues"] == 1
        assert MilestoneIssue.objects.filter(milestone_id=milestone_id).count() == 1
        assert session_client.get(url).json() == {"issue_ids": [str(issue.id)]}

        response = session_client.delete(f"{url}{issue.id}/")
        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert session_client.get(url).json() == {"issue_ids": []}

        response = session_client.post(url, {"issue_ids": [str(issue.id)]}, format="json")
        assert response.json()["total_issues"] == 1
        assert MilestoneIssue.all_objects.filter(milestone_id=milestone_id, issue=issue).count() == 2

    def test_link_rejects_issue_of_other_project(self, session_client, workspace, project, other_project, states):
        milestone_id = _create(session_client, workspace, project).json()["id"]
        foreign = _issue(other_project, None, "fremd")
        own = _issue(project, states["todo"])
        response = session_client.post(
            f"{_base(workspace, project)}/milestones/{milestone_id}/issues/",
            {"issue_ids": [str(own.id), str(foreign.id)]},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not MilestoneIssue.objects.exists()

    def test_link_requires_issue_ids(self, session_client, workspace, project):
        milestone_id = _create(session_client, workspace, project).json()["id"]
        url = f"{_base(workspace, project)}/milestones/{milestone_id}/issues/"
        assert session_client.post(url, {"issue_ids": []}, format="json").status_code == 400
        assert session_client.post(url, {"issue_ids": ["kein-uuid"]}, format="json").status_code == 400

    def test_issue_milestones_get_and_replace(self, session_client, workspace, project, states):
        a = _create(session_client, workspace, project, name="A", date="2026-12-01").json()["id"]
        b = _create(session_client, workspace, project, name="B", date="2026-11-01").json()["id"]
        c = _create(session_client, workspace, project, name="C", date="2027-01-01").json()["id"]
        issue = _issue(project, states["todo"])
        url = f"{_base(workspace, project)}/issues/{issue.id}/milestones/"
        assert session_client.get(url).json() == {"milestone_ids": []}

        response = session_client.put(url, {"milestone_ids": [a, b]}, format="json")
        assert response.status_code == status.HTTP_200_OK, response.content
        # nach Datum sortiert
        assert response.json() == {"milestone_ids": [b, a]}

        response = session_client.put(url, {"milestone_ids": [a, c]}, format="json")
        assert response.json() == {"milestone_ids": [a, c]}
        assert session_client.get(url).json() == {"milestone_ids": [a, c]}
        assert MilestoneIssue.all_objects.filter(issue=issue, milestone_id=b, deleted_at__isnull=False).exists()

        assert session_client.put(url, {"milestone_ids": []}, format="json").json() == {"milestone_ids": []}

    def test_issue_milestones_rejects_foreign_milestone(self, session_client, workspace, project, other_project):
        foreign = _create(session_client, workspace, other_project).json()["id"]
        issue = _issue(project)
        url = f"{_base(workspace, project)}/issues/{issue.id}/milestones/"
        response = session_client.put(url, {"milestone_ids": [foreign]}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not MilestoneIssue.objects.exists()

    def test_issue_of_other_project_is_not_found(self, session_client, workspace, project, other_project):
        foreign = _issue(other_project)
        url = f"{_base(workspace, project)}/issues/{foreign.id}/milestones/"
        assert session_client.get(url).status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.contract
class TestPermissions:
    def test_guest_can_read_but_not_write(self, session_client, workspace, project, states):
        milestone_id = _create(session_client, workspace, project).json()["id"]
        issue = _issue(project, states["todo"])
        guest = _member_client(workspace, project, role=5)
        base = _base(workspace, project)

        assert guest.get(f"{base}/milestones/").status_code == status.HTTP_200_OK
        assert guest.get(f"{base}/milestones/{milestone_id}/").status_code == status.HTTP_200_OK
        assert guest.get(f"{base}/issues/{issue.id}/milestones/").status_code == status.HTTP_200_OK

        assert _create(guest, workspace, project).status_code == status.HTTP_403_FORBIDDEN
        assert (
            guest.patch(f"{base}/milestones/{milestone_id}/", {"name": "x"}, format="json").status_code
            == status.HTTP_403_FORBIDDEN
        )
        assert guest.delete(f"{base}/milestones/{milestone_id}/").status_code == status.HTTP_403_FORBIDDEN
        assert (
            guest.post(
                f"{base}/milestones/{milestone_id}/issues/", {"issue_ids": [str(issue.id)]}, format="json"
            ).status_code
            == status.HTTP_403_FORBIDDEN
        )
        assert (
            guest.put(
                f"{base}/issues/{issue.id}/milestones/", {"milestone_ids": [milestone_id]}, format="json"
            ).status_code
            == status.HTTP_403_FORBIDDEN
        )
        assert Milestone.objects.get(pk=milestone_id).name == "LP 3 Entwurfsplanung"
        assert not MilestoneIssue.objects.exists()

    def test_member_can_write(self, workspace, project, states):
        member = _member_client(workspace, project, role=15)
        response = _create(member, workspace, project)
        assert response.status_code == status.HTTP_201_CREATED
        milestone_id = response.json()["id"]
        issue = _issue(project, states["todo"])
        response = member.put(
            f"{_base(workspace, project)}/issues/{issue.id}/milestones/",
            {"milestone_ids": [milestone_id]},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        assert member.delete(f"{_base(workspace, project)}/milestones/{milestone_id}/").status_code == 204

    def test_non_member_is_forbidden(self, session_client, workspace, project):
        uid = uuid4().hex[:8]
        user = User.objects.create(email=f"fremd-{uid}@plane.so", username=f"fremd_{uid}")
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
        client = APIClient()
        client.force_authenticate(user=user)
        assert client.get(f"{_base(workspace, project)}/milestones/").status_code == status.HTTP_403_FORBIDDEN
        assert _create(client, workspace, project).status_code == status.HTTP_403_FORBIDDEN

    def test_unauthenticated_is_rejected(self, api_client, workspace, project):
        response = api_client.get(f"{_base(workspace, project)}/milestones/")
        assert response.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)
