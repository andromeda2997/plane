# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace-Wiki (plane.ext.wiki): Seiten ohne Projekt."""

import base64
import uuid
from unittest import mock

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import Page, Project, ProjectMember, ProjectPage, User, WorkspaceMember
from plane.ext.wiki.constants import LIVE_COMPAT_PROJECT_SEGMENT


@pytest.fixture(autouse=True)
def no_celery():
    with mock.patch("celery.app.task.Task.delay"):
        yield


def _member_client(workspace, role):
    user = User.objects.create(email=f"u-{uuid.uuid4().hex[:8]}@plane.so", username=f"u_{uuid.uuid4().hex[:8]}")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=role, is_active=True)
    client = APIClient()
    client.force_authenticate(user=user)
    return user, client


def _url(slug, page_id=None, suffix=""):
    base = f"/api/workspaces/{slug}/pages/"
    if page_id:
        base = f"{base}{page_id}/"
    return f"{base}{suffix}"


def _live_url(slug, page_id, suffix=""):
    return f"/api/workspaces/{slug}/projects/{LIVE_COMPAT_PROJECT_SEGMENT}/pages/{page_id}/{suffix}"


def _wiki_page(workspace, owner, name="Bürostandard", parent=None, access=Page.PUBLIC_ACCESS):
    return Page.objects.create(
        workspace=workspace, owned_by=owner, name=name, parent=parent, access=access, is_global=True
    )


@pytest.mark.contract
class TestWikiPages:
    @pytest.mark.django_db
    def test_member_creates_lists_and_retrieves(self, session_client, workspace, create_user):
        response = session_client.post(_url(workspace.slug), {"name": "CAD-Richtlinie"}, format="json")
        assert response.status_code == status.HTTP_201_CREATED
        page_id = response.data["id"]
        page = Page.objects.get(pk=page_id)
        assert page.is_global is True
        assert page.owned_by_id == create_user.id
        assert not ProjectPage.objects.filter(page=page).exists()

        child = session_client.post(_url(workspace.slug), {"name": "Layer", "parent": page_id}, format="json")
        assert child.status_code == status.HTTP_201_CREATED
        assert str(child.data["parent"]) == str(page_id)

        response = session_client.get(_url(workspace.slug))
        assert response.status_code == status.HTTP_200_OK
        assert {str(p["id"]) for p in response.data} == {str(page_id), str(child.data["id"])}

        response = session_client.get(_url(workspace.slug, page_id))
        assert response.status_code == status.HTTP_200_OK
        assert response.data["name"] == "CAD-Richtlinie"
        assert "description_html" in response.data

    @pytest.mark.django_db
    def test_project_pages_not_reachable_via_wiki(self, session_client, workspace, create_user):
        project = Project.objects.create(name="P", identifier="PRJ", workspace=workspace)
        ProjectMember.objects.create(workspace=workspace, project=project, member=create_user, role=20)
        # auch eine is_global-Seite mit Projektzuordnung bleibt eine Projekt-Seite
        page = Page.objects.create(workspace=workspace, owned_by=create_user, name="Projekt", is_global=True)
        ProjectPage.objects.create(workspace=workspace, project=project, page=page)

        assert session_client.get(_url(workspace.slug)).data == []
        assert session_client.get(_url(workspace.slug, page.id)).status_code == status.HTTP_404_NOT_FOUND
        assert session_client.get(_live_url(workspace.slug, page.id)).status_code == status.HTTP_404_NOT_FOUND
        response = session_client.patch(
            _live_url(workspace.slug, page.id, "description/"), {"description_html": "<p>x</p>"}, format="json"
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND

    @pytest.mark.django_db
    def test_wiki_page_not_reachable_via_project(self, session_client, workspace, create_user):
        project = Project.objects.create(name="P", identifier="PRJ", workspace=workspace)
        ProjectMember.objects.create(workspace=workspace, project=project, member=create_user, role=20)
        page = _wiki_page(workspace, create_user)

        response = session_client.get(f"/api/workspaces/{workspace.slug}/projects/{project.id}/pages/{page.id}/")
        assert response.status_code in (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND)

    @pytest.mark.django_db
    def test_guest_read_only(self, workspace, create_user):
        page = _wiki_page(workspace, create_user)
        _, guest = _member_client(workspace, role=5)

        assert guest.get(_url(workspace.slug)).status_code == status.HTTP_200_OK
        assert guest.get(_url(workspace.slug, page.id)).status_code == status.HTTP_200_OK
        assert guest.get(_live_url(workspace.slug, page.id)).status_code == status.HTTP_200_OK
        assert guest.get(_url(workspace.slug, page.id, "description/")).status_code == status.HTTP_200_OK

        denied = [
            guest.post(_url(workspace.slug), {"name": "x"}, format="json"),
            guest.patch(_url(workspace.slug, page.id), {"name": "x"}, format="json"),
            guest.patch(_live_url(workspace.slug, page.id), {"name": "x"}, format="json"),
            guest.patch(_url(workspace.slug, page.id, "description/"), {"description_html": "<p>x</p>"}, format="json"),
            guest.patch(
                _live_url(workspace.slug, page.id, "description/"), {"description_html": "<p>x</p>"}, format="json"
            ),
            guest.post(_url(workspace.slug, page.id, "archive/")),
            guest.post(_url(workspace.slug, page.id, "lock/")),
        ]
        assert all(r.status_code == status.HTTP_403_FORBIDDEN for r in denied), [r.status_code for r in denied]
        page.refresh_from_db()
        assert page.name == "Bürostandard"

    @pytest.mark.django_db
    def test_non_member_denied(self, workspace, create_user):
        page = _wiki_page(workspace, create_user)
        outsider = User.objects.create(email="out@plane.so", username="outsider")
        client = APIClient()
        client.force_authenticate(user=outsider)
        assert client.get(_url(workspace.slug)).status_code == status.HTTP_403_FORBIDDEN
        assert client.get(_live_url(workspace.slug, page.id)).status_code == status.HTTP_403_FORBIDDEN

    @pytest.mark.django_db
    def test_private_page_only_owner(self, workspace, create_user, session_client):
        private = _wiki_page(workspace, create_user, name="Privat", access=Page.PRIVATE_ACCESS)
        _, member = _member_client(workspace, role=15)

        assert member.get(_url(workspace.slug)).data == []
        assert member.get(_url(workspace.slug, private.id)).status_code == status.HTTP_404_NOT_FOUND
        assert session_client.get(_url(workspace.slug, private.id)).status_code == status.HTTP_200_OK

    @pytest.mark.django_db
    def test_member_edits_public_page_but_cannot_change_access(self, workspace, create_user):
        page = _wiki_page(workspace, create_user)
        _, member = _member_client(workspace, role=15)

        response = member.patch(_url(workspace.slug, page.id), {"name": "Neu"}, format="json")
        assert response.status_code == status.HTTP_200_OK
        response = member.post(_url(workspace.slug, page.id, "access/"), {"access": 1}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        response = member.post(_url(workspace.slug, page.id, "archive/"))
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        page.refresh_from_db()
        assert page.name == "Neu"
        assert page.access == Page.PUBLIC_ACCESS
        assert page.archived_at is None

    @pytest.mark.django_db
    def test_move_cycle_archive_and_delete(self, session_client, workspace, create_user):
        a = _wiki_page(workspace, create_user, "A")
        b = _wiki_page(workspace, create_user, "B", parent=a)
        c = _wiki_page(workspace, create_user, "C", parent=b)

        response = session_client.patch(_url(workspace.slug, a.id), {"parent": str(c.id)}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        response = session_client.patch(_url(workspace.slug, c.id), {"parent": None}, format="json")
        assert response.status_code == status.HTTP_200_OK
        c.refresh_from_db()
        assert c.parent_id is None
        response = session_client.patch(_url(workspace.slug, c.id), {"parent": str(a.id)}, format="json")
        assert response.status_code == status.HTTP_200_OK

        # Archivieren nimmt Unterseiten mit
        response = session_client.post(_url(workspace.slug, a.id, "archive/"))
        assert response.status_code == status.HTTP_200_OK
        for p in (a, b, c):
            p.refresh_from_db()
            assert p.archived_at is not None

        # Löschen nur archiviert; Unterseiten rücken eine Ebene hoch (hier: oberste Ebene)
        response = session_client.delete(_url(workspace.slug, a.id))
        assert response.status_code == status.HTTP_204_NO_CONTENT
        b.refresh_from_db()
        c.refresh_from_db()
        assert b.parent_id is None and c.parent_id is None
        assert b.deleted_at is None

        response = session_client.delete(_url(workspace.slug, b.id, "archive/"))
        assert response.status_code == status.HTTP_204_NO_CONTENT
        b.refresh_from_db()
        assert b.archived_at is None

    @pytest.mark.django_db
    def test_delete_requires_archive(self, session_client, workspace, create_user):
        page = _wiki_page(workspace, create_user)
        response = session_client.delete(_url(workspace.slug, page.id))
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.django_db
    def test_live_alias_roundtrip(self, workspace, create_user):
        page = _wiki_page(workspace, create_user)
        _, member = _member_client(workspace, role=15)

        response = member.patch(_live_url(workspace.slug, page.id), {"name": "Titel aus Live"}, format="json")
        assert response.status_code == status.HTTP_200_OK

        response = member.patch(
            _live_url(workspace.slug, page.id, "description/"),
            {
                "description_binary": base64.b64encode(b"\x00\x01binary").decode(),
                "description_html": "<p>Inhalt</p>",
            },
            format="json",
        )
        # Binärdaten werden validiert; ungültiges Y.js-Format darf nicht 500 werfen
        assert response.status_code in (status.HTTP_200_OK, status.HTTP_400_BAD_REQUEST)

        response = member.patch(
            _live_url(workspace.slug, page.id, "description/"),
            {"description_html": "<p>Inhalt</p>"},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        page.refresh_from_db()
        assert page.name == "Titel aus Live"
        assert "Inhalt" in page.description_html

        response = member.get(_live_url(workspace.slug, page.id, "description/"))
        assert response.status_code == status.HTTP_200_OK

    @pytest.mark.django_db
    def test_locked_page_rejects_updates(self, session_client, workspace, create_user):
        page = _wiki_page(workspace, create_user)
        assert session_client.post(_url(workspace.slug, page.id, "lock/")).status_code == status.HTTP_204_NO_CONTENT
        response = session_client.patch(
            _url(workspace.slug, page.id, "description/"), {"description_html": "<p>x</p>"}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert session_client.delete(_url(workspace.slug, page.id, "lock/")).status_code == status.HTTP_204_NO_CONTENT

    @pytest.mark.django_db
    def test_versions_and_duplicate(self, session_client, workspace, create_user):
        page = _wiki_page(workspace, create_user)
        response = session_client.get(_url(workspace.slug, page.id, "versions/"))
        assert response.status_code == status.HTTP_200_OK
        assert response.data == []

        response = session_client.post(_url(workspace.slug, page.id, "duplicate/"))
        assert response.status_code == status.HTTP_201_CREATED
        dup = Page.objects.get(pk=response.data["id"])
        assert dup.is_global is True
        assert not ProjectPage.objects.filter(page=dup).exists()


@pytest.mark.contract
class TestWikiNavigationPreference:
    @pytest.mark.django_db
    def test_wiki_preference_key_created_and_pinned(self, session_client, workspace):
        response = session_client.get(f"/api/workspaces/{workspace.slug}/sidebar-preferences/")
        assert response.status_code == status.HTTP_200_OK
        assert response.data["wiki"]["is_pinned"] is True

        response = session_client.patch(
            f"/api/workspaces/{workspace.slug}/sidebar-preferences/",
            [{"key": "wiki", "is_pinned": False}],
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        response = session_client.get(f"/api/workspaces/{workspace.slug}/sidebar-preferences/")
        assert response.data["wiki"]["is_pinned"] is False


@pytest.mark.contract
class TestWikiPageAssets:
    @pytest.mark.django_db
    def test_image_upload_for_wiki_page(self, session_client, workspace, create_user):
        from plane.db.models import FileAsset

        page = _wiki_page(workspace, create_user)
        response = session_client.post(
            f"/api/assets/v2/workspaces/{workspace.slug}/",
            {
                "name": "grundriss.png",
                "type": "image/png",
                "size": 1024,
                "entity_type": "PAGE_DESCRIPTION",
                "entity_identifier": str(page.id),
            },
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK, response.data
        asset_id = response.data["asset_id"]
        asset = FileAsset.objects.get(pk=asset_id)
        assert asset.page_id == page.id
        assert asset.project_id is None

        response = session_client.patch(f"/api/assets/v2/workspaces/{workspace.slug}/{asset_id}/", {}, format="json")
        assert response.status_code == status.HTTP_204_NO_CONTENT

        # Gäste (lesend) dürfen das Bild abrufen
        _, guest = _member_client(workspace, role=5)
        response = guest.get(f"/api/assets/v2/workspaces/{workspace.slug}/{asset_id}/")
        assert response.status_code == status.HTTP_302_FOUND
