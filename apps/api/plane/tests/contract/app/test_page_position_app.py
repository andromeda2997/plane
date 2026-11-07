# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Verschieben + Sortieren in einem Aufruf (Drag-and-Drop im Seitenbaum).

POST .../projects/<project_id>/pages/<page_id>/position/  (Projekt-Seiten)
POST .../pages/<page_id>/position/                       (Workspace-Wiki)
Körper: {"parent": <uuid|null>, "sort_order": <float>} oder {"parent": …, "order": [ids]}.
"""

import uuid
from unittest import mock

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import Page, Project, ProjectMember, ProjectPage, User, WorkspaceMember


@pytest.fixture(autouse=True)
def no_celery():
    with mock.patch("celery.app.task.Task.delay"):
        yield


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(name="Bauvorhaben", identifier="BAU", workspace=workspace)
    ProjectMember.objects.create(workspace=workspace, project=project, member=create_user, role=20, is_active=True)
    return project


def _user_client(workspace, workspace_role, project=None, project_role=None):
    user = User.objects.create(email=f"u-{uuid.uuid4().hex[:8]}@plane.so", username=f"u_{uuid.uuid4().hex[:8]}")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=workspace_role, is_active=True)
    if project is not None:
        ProjectMember.objects.create(
            workspace=workspace, project=project, member=user, role=project_role, is_active=True
        )
    client = APIClient()
    client.force_authenticate(user=user)
    return user, client


def _project_page(workspace, project, owner, name, parent=None, sort_order=Page.DEFAULT_SORT_ORDER, **extra):
    page = Page.objects.create(
        workspace=workspace,
        owned_by=owner,
        access=extra.pop("access", Page.PUBLIC_ACCESS),
        name=name,
        parent=parent,
        sort_order=sort_order,
        **extra,
    )
    ProjectPage.objects.create(workspace=workspace, project=project, page=page)
    return page


def _wiki_page(workspace, owner, name, parent=None, sort_order=Page.DEFAULT_SORT_ORDER, **extra):
    return Page.objects.create(
        workspace=workspace,
        owned_by=owner,
        access=extra.pop("access", Page.PUBLIC_ACCESS),
        name=name,
        parent=parent,
        sort_order=sort_order,
        is_global=True,
        **extra,
    )


def _project_move_url(slug, project_id, page_id):
    return f"/api/workspaces/{slug}/projects/{project_id}/pages/{page_id}/position/"


def _wiki_move_url(slug, page_id):
    return f"/api/workspaces/{slug}/pages/{page_id}/position/"


def _state(page):
    page.refresh_from_db()
    return page.parent_id, page.sort_order


@pytest.mark.contract
class TestProjectPageMove:
    @pytest.mark.django_db
    def test_reorder_within_same_parent(self, session_client, workspace, project, create_user):
        a = _project_page(workspace, project, create_user, "A", sort_order=10000)
        b = _project_page(workspace, project, create_user, "B", sort_order=20000)
        c = _project_page(workspace, project, create_user, "C", sort_order=30000)

        # C zwischen A und B (Mittelwert der Nachbarn)
        response = session_client.post(
            _project_move_url(workspace.slug, project.id, c.id), {"parent": None, "sort_order": 15000}, format="json"
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["parent"] is None
        assert response.data["sort_order"] == 15000
        assert response.data["sort_orders"] == {str(c.id): 15000}
        assert _state(c) == (None, 15000)
        ordered = list(
            Page.objects.filter(pk__in=[a.id, b.id, c.id]).order_by("sort_order").values_list("name", flat=True)
        )
        assert ordered == ["A", "C", "B"]

    @pytest.mark.django_db
    def test_reparent_and_sort_order_together(self, session_client, workspace, project, create_user):
        parent = _project_page(workspace, project, create_user, "Eltern")
        child = _project_page(workspace, project, create_user, "Kind", parent=parent, sort_order=10000)
        moving = _project_page(workspace, project, create_user, "Neu")

        response = session_client.post(
            _project_move_url(workspace.slug, project.id, moving.id),
            {"parent": str(parent.id), "sort_order": 20000},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["parent"] == str(parent.id)
        assert _state(moving) == (parent.id, 20000)

        # zurück auf die oberste Ebene, an den Anfang
        response = session_client.post(
            _project_move_url(workspace.slug, project.id, child.id),
            {"parent": None, "sort_order": -5000},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        assert _state(child) == (None, -5000)

    @pytest.mark.django_db
    def test_cycle_rejected_and_nothing_changed(self, session_client, workspace, project, create_user):
        a = _project_page(workspace, project, create_user, "A", sort_order=10000)
        b = _project_page(workspace, project, create_user, "B", parent=a, sort_order=10000)
        c = _project_page(workspace, project, create_user, "C", parent=b, sort_order=10000)

        for target in (c, a):
            response = session_client.post(
                _project_move_url(workspace.slug, project.id, a.id),
                {"parent": str(target.id), "sort_order": 99999},
                format="json",
            )
            assert response.status_code == status.HTTP_400_BAD_REQUEST
            assert _state(a) == (None, 10000)

        # auch der Neu-Nummerierungs-Pfad schreibt bei einem Zyklus nichts
        response = session_client.post(
            _project_move_url(workspace.slug, project.id, a.id),
            {"parent": str(c.id), "order": [str(a.id)]},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert _state(a) == (None, 10000)

    @pytest.mark.django_db
    def test_parent_from_other_project_rejected(self, session_client, workspace, project, create_user):
        other = Project.objects.create(name="Anderes", identifier="AND", workspace=workspace)
        ProjectMember.objects.create(workspace=workspace, project=other, member=create_user, role=20, is_active=True)
        foreign = _project_page(workspace, other, create_user, "Fremd")
        wiki = _wiki_page(workspace, create_user, "Wiki")
        page = _project_page(workspace, project, create_user, "Hier", sort_order=10000)

        for parent in (foreign, wiki):
            response = session_client.post(
                _project_move_url(workspace.slug, project.id, page.id),
                {"parent": str(parent.id), "sort_order": 5},
                format="json",
            )
            assert response.status_code == status.HTTP_400_BAD_REQUEST
            assert _state(page) == (None, 10000)

        # Seite aus einem anderen Projekt über die URL dieses Projekts: nicht gefunden/verboten
        response = session_client.post(
            _project_move_url(workspace.slug, project.id, foreign.id), {"parent": None, "sort_order": 5}, format="json"
        )
        assert response.status_code in (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND)
        assert _state(foreign) == (None, Page.DEFAULT_SORT_ORDER)

    @pytest.mark.django_db
    def test_locked_archived_and_archived_parent_rejected(self, session_client, workspace, project, create_user):
        locked = _project_page(workspace, project, create_user, "Gesperrt", is_locked=True)
        archived = _project_page(workspace, project, create_user, "Archiviert", archived_at=timezone.now())
        page = _project_page(workspace, project, create_user, "Normal")

        for target, parent in ((locked, None), (archived, None), (page, archived)):
            response = session_client.post(
                _project_move_url(workspace.slug, project.id, target.id),
                {"parent": str(parent.id) if parent else None, "sort_order": 1},
                format="json",
            )
            assert response.status_code == status.HTTP_400_BAD_REQUEST
            assert _state(target)[1] == Page.DEFAULT_SORT_ORDER

    @pytest.mark.django_db
    def test_invalid_payload(self, session_client, workspace, project, create_user):
        page = _project_page(workspace, project, create_user, "P")
        url = _project_move_url(workspace.slug, project.id, page.id)
        for payload in (
            {"sort_order": 1},  # parent fehlt
            {"parent": None},  # weder sort_order noch order
            {"parent": None, "sort_order": "abc"},
            {"parent": None, "sort_order": "NaN"},
            {"parent": None, "sort_order": True},
            {"parent": "keine-uuid", "sort_order": 1},
            {"parent": None, "order": []},
            {"parent": None, "order": [str(page.id), str(page.id)]},
        ):
            response = session_client.post(url, payload, format="json")
            assert response.status_code == status.HTTP_400_BAD_REQUEST, payload
        assert _state(page) == (None, Page.DEFAULT_SORT_ORDER)

    @pytest.mark.django_db
    def test_guest_cannot_move_even_own_private_page(self, workspace, project, create_user):
        guest, client = _user_client(workspace, 5, project, 5)
        own = _project_page(workspace, project, guest, "Privat", access=Page.PRIVATE_ACCESS)
        public = _project_page(workspace, project, create_user, "Öffentlich")
        for page in (own, public):
            response = client.post(
                _project_move_url(workspace.slug, project.id, page.id), {"parent": None, "sort_order": 1}, format="json"
            )
            assert response.status_code == status.HTTP_403_FORBIDDEN
            assert _state(page)[1] == Page.DEFAULT_SORT_ORDER

    @pytest.mark.django_db
    def test_member_cannot_move_foreign_private_page(self, workspace, project, create_user):
        _, client = _user_client(workspace, 15, project, 15)
        private = _project_page(workspace, project, create_user, "Privat", access=Page.PRIVATE_ACCESS)
        response = client.post(
            _project_move_url(workspace.slug, project.id, private.id), {"parent": None, "sort_order": 1}, format="json"
        )
        assert response.status_code in (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND)
        assert _state(private)[1] == Page.DEFAULT_SORT_ORDER

    @pytest.mark.django_db
    def test_order_renumbers_tied_siblings(self, session_client, workspace, project, create_user):
        """Alle Bestandsseiten haben sort_order 65535 -> kein Mittelwert möglich, Gruppe wird neu nummeriert."""
        parent = _project_page(workspace, project, create_user, "Eltern")
        a = _project_page(workspace, project, create_user, "A", parent=parent)
        b = _project_page(workspace, project, create_user, "B", parent=parent)
        moving = _project_page(workspace, project, create_user, "Neu")

        response = session_client.post(
            _project_move_url(workspace.slug, project.id, moving.id),
            {"parent": str(parent.id), "order": [str(a.id), str(moving.id), str(b.id)]},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["sort_orders"] == {str(a.id): 10000, str(moving.id): 20000, str(b.id): 30000}
        assert _state(a) == (parent.id, 10000)
        assert _state(moving) == (parent.id, 20000)
        assert _state(b) == (parent.id, 30000)

    @pytest.mark.django_db
    def test_order_rejects_non_siblings_and_foreign_pages(self, session_client, workspace, project, create_user):
        parent = _project_page(workspace, project, create_user, "Eltern")
        child = _project_page(workspace, project, create_user, "Kind", parent=parent)
        top = _project_page(workspace, project, create_user, "Oben")
        moving = _project_page(workspace, project, create_user, "Neu")
        other = Project.objects.create(name="Anderes", identifier="AND", workspace=workspace)
        foreign = _project_page(workspace, other, create_user, "Fremd")

        for order in (
            [str(top.id)],  # verschobene Seite fehlt
            [str(child.id), str(moving.id), str(top.id)],  # "Oben" ist kein Kind von "Eltern"
            [str(child.id), str(moving.id), str(foreign.id)],  # fremdes Projekt
            [str(child.id), str(moving.id), str(uuid.uuid4())],  # unbekannt
        ):
            response = session_client.post(
                _project_move_url(workspace.slug, project.id, moving.id),
                {"parent": str(parent.id), "order": order},
                format="json",
            )
            assert response.status_code == status.HTTP_400_BAD_REQUEST, order
        assert _state(moving) == (None, Page.DEFAULT_SORT_ORDER)
        assert _state(child) == (parent.id, Page.DEFAULT_SORT_ORDER)

    @pytest.mark.django_db
    def test_list_returns_sort_order_and_create_appends(self, session_client, workspace, project, create_user):
        _project_page(workspace, project, create_user, "A", sort_order=10000)
        _project_page(workspace, project, create_user, "B", sort_order=40000)

        response = session_client.post(
            f"/api/workspaces/{workspace.slug}/projects/{project.id}/pages/", {"name": "C"}, format="json"
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["sort_order"] == 50000

        response = session_client.get(f"/api/workspaces/{workspace.slug}/projects/{project.id}/pages/")
        assert response.status_code == status.HTTP_200_OK
        assert {p["name"]: p["sort_order"] for p in response.data} == {"A": 10000, "B": 40000, "C": 50000}


@pytest.mark.contract
class TestWikiPageMove:
    @pytest.mark.django_db
    def test_reorder_and_reparent(self, session_client, workspace, create_user):
        a = _wiki_page(workspace, create_user, "A", sort_order=10000)
        b = _wiki_page(workspace, create_user, "B", sort_order=20000)

        response = session_client.post(
            _wiki_move_url(workspace.slug, b.id), {"parent": None, "sort_order": 5000}, format="json"
        )
        assert response.status_code == status.HTTP_200_OK
        assert _state(b) == (None, 5000)

        response = session_client.post(
            _wiki_move_url(workspace.slug, b.id), {"parent": str(a.id), "sort_order": 10000}, format="json"
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["parent"] == str(a.id)
        assert _state(b) == (a.id, 10000)

    @pytest.mark.django_db
    def test_cycle_rejected_and_nothing_changed(self, session_client, workspace, create_user):
        a = _wiki_page(workspace, create_user, "A", sort_order=10000)
        b = _wiki_page(workspace, create_user, "B", parent=a)
        for target in (b, a):
            response = session_client.post(
                _wiki_move_url(workspace.slug, a.id), {"parent": str(target.id), "sort_order": 1}, format="json"
            )
            assert response.status_code == status.HTTP_400_BAD_REQUEST
            assert _state(a) == (None, 10000)

    @pytest.mark.django_db
    def test_project_page_neither_parent_nor_movable(self, session_client, workspace, project, create_user):
        project_page = _project_page(workspace, project, create_user, "Projekt")
        wiki = _wiki_page(workspace, create_user, "Wiki", sort_order=10000)

        response = session_client.post(
            _wiki_move_url(workspace.slug, wiki.id), {"parent": str(project_page.id), "sort_order": 1}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert _state(wiki) == (None, 10000)

        response = session_client.post(
            _wiki_move_url(workspace.slug, project_page.id), {"parent": None, "sort_order": 1}, format="json"
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert _state(project_page)[1] == Page.DEFAULT_SORT_ORDER

        # Projekt-Seite als Teil der Wiki-Reihenfolge: abgelehnt
        response = session_client.post(
            _wiki_move_url(workspace.slug, wiki.id),
            {"parent": None, "order": [str(wiki.id), str(project_page.id)]},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.django_db
    def test_locked_and_archived_rejected(self, session_client, workspace, create_user):
        locked = _wiki_page(workspace, create_user, "Gesperrt", is_locked=True)
        archived = _wiki_page(workspace, create_user, "Archiviert", archived_at=timezone.now())
        page = _wiki_page(workspace, create_user, "Normal")
        for target, parent in ((locked, None), (archived, None), (page, archived)):
            response = session_client.post(
                _wiki_move_url(workspace.slug, target.id),
                {"parent": str(parent.id) if parent else None, "sort_order": 1},
                format="json",
            )
            assert response.status_code == status.HTTP_400_BAD_REQUEST
            assert _state(target)[1] == Page.DEFAULT_SORT_ORDER

    @pytest.mark.django_db
    def test_guest_forbidden_and_foreign_private_hidden(self, workspace, create_user):
        page = _wiki_page(workspace, create_user, "Öffentlich")
        _, guest = _user_client(workspace, 5)
        response = guest.post(_wiki_move_url(workspace.slug, page.id), {"parent": None, "sort_order": 1}, format="json")
        assert response.status_code == status.HTTP_403_FORBIDDEN

        private = _wiki_page(workspace, create_user, "Privat", access=Page.PRIVATE_ACCESS)
        _, member = _user_client(workspace, 15)
        response = member.post(
            _wiki_move_url(workspace.slug, private.id), {"parent": None, "sort_order": 1}, format="json"
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND
        # fremde private Seite auch nicht als Ziel
        response = member.post(
            _wiki_move_url(workspace.slug, page.id), {"parent": str(private.id), "sort_order": 1}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert _state(page)[1] == Page.DEFAULT_SORT_ORDER
        assert _state(private)[1] == Page.DEFAULT_SORT_ORDER

    @pytest.mark.django_db
    def test_order_renumbers_and_create_appends(self, session_client, workspace, create_user):
        a = _wiki_page(workspace, create_user, "A")
        b = _wiki_page(workspace, create_user, "B")
        c = _wiki_page(workspace, create_user, "C")

        response = session_client.post(
            _wiki_move_url(workspace.slug, c.id),
            {"parent": None, "order": [str(c.id), str(a.id), str(b.id)]},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["sort_orders"] == {str(c.id): 10000, str(a.id): 20000, str(b.id): 30000}

        response = session_client.post(f"/api/workspaces/{workspace.slug}/pages/", {"name": "D"}, format="json")
        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["sort_order"] == 40000

        response = session_client.get(f"/api/workspaces/{workspace.slug}/pages/")
        assert [p["name"] for p in response.data] == ["C", "A", "B", "D"]
