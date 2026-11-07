# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Unterseiten (Page.parent) in Projekt-Seiten.

Vorher filterte PageViewSet.get_queryset() auf parent__isnull=True: Unterseiten
tauchten nicht in der Liste auf, ließen sich nicht abrufen und das Anlegen mit
parent endete in einem 500 (DoesNotExist). Außerdem fehlten Prüfungen auf
Projektzugehörigkeit und Zyklen.
"""

from unittest import mock

import pytest
from rest_framework import status

from plane.db.models import Page, Project, ProjectMember, ProjectPage, User


@pytest.fixture(autouse=True)
def no_celery():
    with mock.patch("celery.app.task.Task.delay"):
        yield


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(name="Bauvorhaben", identifier="BAU", workspace=workspace)
    ProjectMember.objects.create(workspace=workspace, project=project, member=create_user, role=20, is_active=True)
    return project


def _page(workspace, project, owner, name, parent=None):
    page = Page.objects.create(workspace=workspace, owned_by=owner, access=Page.PUBLIC_ACCESS, name=name, parent=parent)
    ProjectPage.objects.create(workspace=workspace, project=project, page=page)
    return page


def _url(slug, project_id, page_id=None, suffix=""):
    base = f"/api/workspaces/{slug}/projects/{project_id}/pages/"
    if page_id:
        base = f"{base}{page_id}/"
    return f"{base}{suffix}"


@pytest.mark.contract
class TestProjectSubPages:
    @pytest.mark.django_db
    def test_create_sub_page_and_list_and_retrieve(self, session_client, workspace, project, create_user):
        root = _page(workspace, project, create_user, "Baubeschreibung")

        response = session_client.post(
            _url(workspace.slug, project.id), {"name": "Rohbau", "parent": str(root.id)}, format="json"
        )
        assert response.status_code == status.HTTP_201_CREATED
        child_id = response.data["id"]
        assert str(response.data["parent"]) == str(root.id)

        response = session_client.get(_url(workspace.slug, project.id))
        assert response.status_code == status.HTTP_200_OK
        ids = {str(p["id"]) for p in response.data}
        assert {str(root.id), str(child_id)} <= ids

        response = session_client.get(_url(workspace.slug, project.id, child_id), {"track_visit": "false"})
        assert response.status_code == status.HTTP_200_OK
        assert str(response.data["parent"]) == str(root.id)

    @pytest.mark.django_db
    def test_create_with_parent_from_other_project_rejected(self, session_client, workspace, project, create_user):
        other = Project.objects.create(name="Anderes", identifier="AND", workspace=workspace)
        foreign = _page(workspace, other, create_user, "Fremd")

        response = session_client.post(
            _url(workspace.slug, project.id), {"name": "X", "parent": str(foreign.id)}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not Page.objects.filter(name="X").exists()

    @pytest.mark.django_db
    def test_move_under_and_cycle_prevention(self, session_client, workspace, project, create_user):
        a = _page(workspace, project, create_user, "A")
        b = _page(workspace, project, create_user, "B", parent=a)
        c = _page(workspace, project, create_user, "C", parent=b)
        d = _page(workspace, project, create_user, "D")

        # D unter C verschieben: erlaubt
        response = session_client.patch(_url(workspace.slug, project.id, d.id), {"parent": str(c.id)}, format="json")
        assert response.status_code == status.HTTP_200_OK
        d.refresh_from_db()
        assert d.parent_id == c.id

        # A unter seinen Enkel C: Zyklus
        response = session_client.patch(_url(workspace.slug, project.id, a.id), {"parent": str(c.id)}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        # unter sich selbst
        response = session_client.patch(_url(workspace.slug, project.id, a.id), {"parent": str(a.id)}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        a.refresh_from_db()
        assert a.parent_id is None

        # zurück auf die oberste Ebene
        response = session_client.patch(_url(workspace.slug, project.id, d.id), {"parent": None}, format="json")
        assert response.status_code == status.HTTP_200_OK
        d.refresh_from_db()
        assert d.parent_id is None

    @pytest.mark.django_db
    def test_archive_cascades_and_delete_pulls_children_up(self, session_client, workspace, project, create_user):
        top = _page(workspace, project, create_user, "Top")
        mid = _page(workspace, project, create_user, "Mid", parent=top)
        leaf = _page(workspace, project, create_user, "Leaf", parent=mid)

        response = session_client.post(_url(workspace.slug, project.id, mid.id, "archive/"))
        assert response.status_code == status.HTTP_200_OK
        mid.refresh_from_db()
        leaf.refresh_from_db()
        top.refresh_from_db()
        assert mid.archived_at is not None
        assert leaf.archived_at is not None
        assert top.archived_at is None

        response = session_client.delete(_url(workspace.slug, project.id, mid.id))
        assert response.status_code == status.HTTP_204_NO_CONTENT
        leaf.refresh_from_db()
        # eine Ebene nach oben gezogen, bleibt archiviert
        assert leaf.parent_id == top.id
        assert leaf.deleted_at is None
        assert leaf.archived_at is not None

        # Wiederherstellen unter aktiver Elternseite: bleibt dort
        response = session_client.delete(_url(workspace.slug, project.id, leaf.id, "archive/"))
        assert response.status_code == status.HTTP_204_NO_CONTENT
        leaf.refresh_from_db()
        assert leaf.archived_at is None
        assert leaf.parent_id == top.id


@pytest.mark.contract
class TestProjectSubPageVisibility:
    @pytest.mark.django_db
    def test_cannot_attach_to_foreign_private_page(self, session_client, workspace, project, create_user):
        other = User.objects.create(email="other@plane.so", username="other_user")
        ProjectMember.objects.create(workspace=workspace, project=project, member=other, role=15, is_active=True)
        private = Page.objects.create(workspace=workspace, owned_by=other, access=Page.PRIVATE_ACCESS, name="Privat")
        ProjectPage.objects.create(workspace=workspace, project=project, page=private)

        response = session_client.post(
            _url(workspace.slug, project.id), {"name": "Kind", "parent": str(private.id)}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
