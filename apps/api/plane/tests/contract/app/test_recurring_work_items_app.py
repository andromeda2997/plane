# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""API for recurring work items (plane.ext.recurring)."""

from unittest import mock
from uuid import uuid4

import pytest
from rest_framework import status

from plane.db.models import Issue, Label, Project, ProjectMember, State, User, WorkspaceMember
from plane.ext.recurring.models import RecurringWorkItem


@pytest.fixture(autouse=True)
def _mock_background_tasks():
    with (
        mock.patch("plane.ext.recurring.services.issue_activity"),
        mock.patch("plane.ext.recurring.services.model_activity"),
        mock.patch("plane.db.mixins.soft_delete_related_objects"),
    ):
        yield


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(name="Wohnhaus", identifier="WH", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    State.objects.create(name="Todo", project=project, group="unstarted", default=True)
    return project


def url(workspace, project, suffix=""):
    return f"/api/workspaces/{workspace.slug}/projects/{project.id}/recurring-work-items/{suffix}"


def payload(**kwargs):
    data = {
        "name": "Baustellenbegehung",
        "description_html": "<p>Rundgang</p>",
        "priority": "medium",
        "frequency": "weekly",
        "weekdays": [3],
        "start_date": "2026-01-01",
        "duration_days": 1,
    }
    data.update(kwargs)
    return data


@pytest.mark.contract
@pytest.mark.django_db
class TestRecurringWorkItemsAPI:
    def test_create_list_update_delete(self, session_client, workspace, project, create_user):
        response = session_client.post(
            url(workspace, project), payload(assignee_ids=[str(create_user.id)]), format="json"
        )
        assert response.status_code == status.HTTP_201_CREATED, response.data
        rule_id = response.data["id"]
        assert response.data["next_occurrence_date"] is not None
        assert response.data["assignee_ids"] == [str(create_user.id)]

        response = session_client.get(url(workspace, project))
        assert response.status_code == status.HTTP_200_OK
        assert [r["id"] for r in response.data] == [rule_id]

        response = session_client.patch(
            url(workspace, project, f"{rule_id}/"), {"frequency": "monthly", "month_day": 31}, format="json"
        )
        assert response.status_code == status.HTTP_200_OK, response.data
        assert response.data["frequency"] == "monthly"

        response = session_client.delete(url(workspace, project, f"{rule_id}/"))
        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not RecurringWorkItem.objects.filter(pk=rule_id).exists()

    def test_validation(self, session_client, workspace, project):
        response = session_client.post(url(workspace, project), payload(weekdays=[]), format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        response = session_client.post(url(workspace, project), payload(frequency="monthly"), format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        response = session_client.post(
            url(workspace, project), payload(end_type="on_date", end_date="2025-01-01"), format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_label_from_other_project_is_rejected(self, session_client, workspace, project, create_user):
        other = Project.objects.create(name="Fremd", identifier="FR", workspace=workspace, created_by=create_user)
        label = Label.objects.create(name="Fremd", project=other)
        response = session_client.post(url(workspace, project), payload(label_ids=[str(label.id)]), format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_pause_resume_and_run(self, session_client, workspace, project):
        rule_id = session_client.post(url(workspace, project), payload(), format="json").data["id"]

        response = session_client.post(url(workspace, project, f"{rule_id}/pause/"))
        assert response.status_code == status.HTTP_200_OK
        assert response.data["is_active"] is False
        assert response.data["next_run_at"] is None

        response = session_client.post(url(workspace, project, f"{rule_id}/resume/"))
        assert response.data["is_active"] is True
        assert response.data["next_run_at"] is not None

        response = session_client.post(url(workspace, project, f"{rule_id}/run/"))
        assert response.status_code == status.HTTP_201_CREATED, response.data
        issue_id = response.data["run"]["issue"]
        assert Issue.objects.filter(pk=issue_id, project=project, name="Baustellenbegehung").exists()

        response = session_client.get(url(workspace, project, f"{rule_id}/runs/"))
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 1
        assert response.data[0]["trigger"] == "manual"

    def test_guest_is_forbidden(self, api_client, workspace, project):
        uid = uuid4().hex[:8]
        guest = User.objects.create(email=f"guest-{uid}@plane.so", username=f"guest_{uid}")
        WorkspaceMember.objects.create(workspace=workspace, member=guest, role=5)
        ProjectMember.objects.create(project=project, member=guest, role=5, is_active=True)
        api_client.force_authenticate(user=guest)
        assert api_client.get(url(workspace, project)).status_code == status.HTTP_403_FORBIDDEN
        assert api_client.post(url(workspace, project), payload(), format="json").status_code == (
            status.HTTP_403_FORBIDDEN
        )
