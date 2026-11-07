# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace-Wiki: Seiten ohne Projekt.

Eine Wiki-Seite ist eine Page mit is_global=True im Workspace, die keiner
(aktiven) ProjectPage-Zuordnung hat. Damit sind Projekt-Seiten über diese
Endpunkte nie erreichbar und Wiki-Seiten nie über die Projekt-Endpunkte
(die immer eine ProjectPage-Zuordnung verlangen).
"""

# Python imports
import json

# Django imports
from django.core.serializers.json import DjangoJSONEncoder
from django.db.models import Exists, OuterRef, Q
from django.http import StreamingHttpResponse
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE
from plane.app.serializers import (
    PageBinaryUpdateSerializer,
    PageVersionDetailSerializer,
    PageVersionSerializer,
)
from plane.app.views.base import BaseAPIView
from plane.app.views.page.base import unarchive_archive_page_and_descendants
from plane.bgtasks.copy_s3_object import copy_s3_objects_of_description_and_assets
from plane.bgtasks.page_transaction_task import page_transaction
from plane.bgtasks.page_version_task import track_page_version
from plane.db.models import (
    Page,
    PageVersion,
    ProjectPage,
    UserFavorite,
    UserRecentVisit,
    Workspace,
)
from plane.utils.content_validator import validate_html_content
from plane.utils.error_codes import ERROR_CODES
from plane.utils.page_tree import is_invalid_parent

# Local imports
from .permissions import WorkspaceWikiPermission
from .serializers import WikiPageDetailSerializer, WikiPageSerializer


def wiki_pages_queryset(slug):
    """Alle Wiki-Seiten eines Workspaces (ohne Sichtbarkeitsfilter)."""
    return (
        Page.objects.filter(workspace__slug=slug, is_global=True)
        .annotate(has_project=Exists(ProjectPage.objects.filter(page_id=OuterRef("pk"), deleted_at__isnull=True)))
        .filter(has_project=False)
    )


def visible_wiki_pages(slug, user):
    """Wiki-Seiten, die der Nutzer sehen darf: öffentliche und eigene private."""
    return wiki_pages_queryset(slug).filter(Q(owned_by=user) | Q(access=Page.PUBLIC_ACCESS))


def is_owner_or_admin(request, page):
    return page.owned_by_id == request.user.id or getattr(request, "wiki_workspace_role", None) == ROLE.ADMIN.value


class WikiBaseEndpoint(BaseAPIView):
    permission_classes = [WorkspaceWikiPermission]

    def get_page(self, slug, page_id):
        return visible_wiki_pages(slug, self.request.user).filter(pk=page_id).first()

    def not_found(self):
        return Response({"error": "Page not found"}, status=status.HTTP_404_NOT_FOUND)

    def validate_parent(self, slug, page, parent_id):
        """Gibt eine Fehler-Response zurück oder None, wenn parent_id gültig ist."""
        if parent_id is None:
            return None
        parent = self.get_page(slug, parent_id)
        if parent is None or parent.archived_at is not None:
            return Response(
                {"error": "Parent page not found in the wiki"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if page is not None and is_invalid_parent(page.id, parent.id):
            return Response(
                {"error": "A page cannot be moved under itself or one of its sub pages"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return None


class WikiPageListEndpoint(WikiBaseEndpoint):
    def get(self, request, slug):
        pages = (
            visible_wiki_pages(slug, request.user)
            .select_related("owned_by")
            .order_by("sort_order", "-created_at", "id")
        )
        return Response(WikiPageSerializer(pages, many=True).data, status=status.HTTP_200_OK)

    def post(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)
        parent_id = request.data.get("parent") or None
        error = self.validate_parent(slug, None, parent_id)
        if error:
            return error

        access = request.data.get("access", Page.PUBLIC_ACCESS)
        if access not in (Page.PUBLIC_ACCESS, Page.PRIVATE_ACCESS):
            return Response({"error": "Invalid access"}, status=status.HTTP_400_BAD_REQUEST)

        description_html = request.data.get("description_html") or "<p></p>"
        is_valid, error_message, sanitized_html = validate_html_content(description_html)
        if not is_valid:
            return Response({"error": error_message}, status=status.HTTP_400_BAD_REQUEST)
        if sanitized_html is not None:
            description_html = sanitized_html

        serializer = WikiPageSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        page = serializer.save(
            workspace=workspace,
            owned_by=request.user,
            access=access,
            parent_id=parent_id,
            is_global=True,
            description_html=description_html,
        )
        page_transaction.delay(
            new_description_html=description_html,
            old_description_html=None,
            page_id=page.id,
        )
        return Response(WikiPageDetailSerializer(page).data, status=status.HTTP_201_CREATED)


class WikiPageDetailEndpoint(WikiBaseEndpoint):
    def get(self, request, slug, page_id):
        page = self.get_page(slug, page_id)
        if page is None:
            return self.not_found()
        return Response(WikiPageDetailSerializer(page).data, status=status.HTTP_200_OK)

    def patch(self, request, slug, page_id):
        page = self.get_page(slug, page_id)
        if page is None:
            return self.not_found()

        if page.is_locked:
            return Response({"error": "Page is locked"}, status=status.HTTP_400_BAD_REQUEST)

        # Verschieben unter eine andere Seite (oder auf die oberste Ebene: null)
        if "parent" in request.data:
            parent_id = request.data.get("parent") or None
            error = self.validate_parent(slug, page, parent_id)
            if error:
                return error
            page.parent_id = parent_id

        # Sichtbarkeit darf nur der Besitzer ändern (wie bei Projekt-Seiten)
        if "access" in request.data and request.data.get("access") != page.access:
            if page.owned_by_id != request.user.id:
                return Response(
                    {"error": "Access cannot be updated since this page is owned by someone else"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if request.data.get("access") not in (Page.PUBLIC_ACCESS, Page.PRIVATE_ACCESS):
                return Response({"error": "Invalid access"}, status=status.HTTP_400_BAD_REQUEST)
            page.access = request.data.get("access")

        serializer = WikiPageDetailSerializer(page, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        # speichert auch parent/access, die oben auf der Instanz gesetzt wurden
        page = serializer.save()
        return Response(WikiPageDetailSerializer(page).data, status=status.HTTP_200_OK)

    def delete(self, request, slug, page_id):
        page = self.get_page(slug, page_id)
        if page is None:
            return self.not_found()

        if page.archived_at is None:
            return Response(
                {"error": "The page should be archived before deleting"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not is_owner_or_admin(request, page):
            return Response(
                {"error": "Only admin or owner can delete the page"},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Unterseiten nicht mitlöschen, sondern eine Ebene nach oben ziehen.
        # Wichtig vor page.delete(): das Soft-Delete räumt CASCADE-Beziehungen
        # (child_page) sonst im Hintergrund mit ab.
        Page.objects.filter(parent_id=page.id, workspace__slug=slug).update(parent=page.parent_id)

        page.delete()
        UserFavorite.objects.filter(workspace__slug=slug, entity_identifier=page_id, entity_type="page").delete()
        UserRecentVisit.objects.filter(workspace__slug=slug, entity_identifier=page_id, entity_name="page").delete(
            soft=False
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class WikiPageArchiveEndpoint(WikiBaseEndpoint):
    def post(self, request, slug, page_id):
        page = self.get_page(slug, page_id)
        if page is None:
            return self.not_found()
        if not is_owner_or_admin(request, page):
            return Response(
                {"error": "Only the owner or admin can archive the page"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        archived_at = timezone.now()
        # Unterseiten werden mitarchiviert (gleiches Verhalten wie im Projekt)
        unarchive_archive_page_and_descendants(page.id, archived_at)
        return Response({"archived_at": str(archived_at)}, status=status.HTTP_200_OK)

    def delete(self, request, slug, page_id):
        page = self.get_page(slug, page_id)
        if page is None:
            return self.not_found()
        if not is_owner_or_admin(request, page):
            return Response(
                {"error": "Only the owner or admin can un archive the page"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Ist die übergeordnete Seite noch archiviert, landet die Seite auf der obersten Ebene
        if page.parent_id and page.parent.archived_at:
            page.parent = None
            page.save(update_fields=["parent"])
        unarchive_archive_page_and_descendants(page.id, None)
        return Response(status=status.HTTP_204_NO_CONTENT)


class WikiPageLockEndpoint(WikiBaseEndpoint):
    def _set_lock(self, request, slug, page_id, value):
        page = self.get_page(slug, page_id)
        if page is None:
            return self.not_found()
        if not is_owner_or_admin(request, page):
            return Response(
                {"error": "Only the owner or admin can lock the page"},
                status=status.HTTP_403_FORBIDDEN,
            )
        page.is_locked = value
        page.save(update_fields=["is_locked", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    def post(self, request, slug, page_id):
        return self._set_lock(request, slug, page_id, True)

    def delete(self, request, slug, page_id):
        return self._set_lock(request, slug, page_id, False)


class WikiPageAccessEndpoint(WikiBaseEndpoint):
    def post(self, request, slug, page_id):
        page = self.get_page(slug, page_id)
        if page is None:
            return self.not_found()
        access = request.data.get("access", Page.PUBLIC_ACCESS)
        if access not in (Page.PUBLIC_ACCESS, Page.PRIVATE_ACCESS):
            return Response({"error": "Invalid access"}, status=status.HTTP_400_BAD_REQUEST)
        if page.access != access and page.owned_by_id != request.user.id:
            return Response(
                {"error": "Access cannot be updated since this page is owned by someone else"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        page.access = access
        page.save(update_fields=["access", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class WikiPageDescriptionEndpoint(WikiBaseEndpoint):
    def get(self, request, slug, page_id):
        page = self.get_page(slug, page_id)
        if page is None:
            return self.not_found()
        binary_data = page.description_binary

        def stream_data():
            yield bytes(binary_data) if binary_data else b""

        response = StreamingHttpResponse(stream_data(), content_type="application/octet-stream")
        response["Content-Disposition"] = 'attachment; filename="page_description.bin"'
        return response

    def patch(self, request, slug, page_id):
        page = self.get_page(slug, page_id)
        if page is None:
            return self.not_found()

        if page.is_locked:
            return Response(
                {"error_code": ERROR_CODES["PAGE_LOCKED"], "error_message": "PAGE_LOCKED"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if page.archived_at:
            return Response(
                {"error_code": ERROR_CODES["PAGE_ARCHIVED"], "error_message": "PAGE_ARCHIVED"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        old_description_html = page.description_html
        existing_instance = json.dumps({"description_html": old_description_html}, cls=DjangoJSONEncoder)

        serializer = PageBinaryUpdateSerializer(page, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        serializer.save()

        if request.data.get("description_html"):
            page_transaction.delay(
                new_description_html=request.data.get("description_html", "<p></p>"),
                old_description_html=old_description_html,
                page_id=page_id,
            )
        track_page_version.delay(page_id=page_id, existing_instance=existing_instance, user_id=request.user.id)
        return Response({"message": "Updated successfully"})


class WikiPageVersionEndpoint(WikiBaseEndpoint):
    def get(self, request, slug, page_id, pk=None):
        page = self.get_page(slug, page_id)
        if page is None:
            return self.not_found()
        if pk:
            version = PageVersion.objects.filter(workspace__slug=slug, page_id=page.id, pk=pk).first()
            if version is None:
                return Response({"error": "Version not found"}, status=status.HTTP_404_NOT_FOUND)
            return Response(PageVersionDetailSerializer(version).data, status=status.HTTP_200_OK)
        versions = PageVersion.objects.filter(workspace__slug=slug, page_id=page.id)
        return Response(PageVersionSerializer(versions, many=True).data, status=status.HTTP_200_OK)


class WikiPageDuplicateEndpoint(WikiBaseEndpoint):
    def post(self, request, slug, page_id):
        page = self.get_page(slug, page_id)
        if page is None:
            return self.not_found()

        page.pk = None
        page.name = f"{page.name} (Copy)"
        page.description_binary = None
        page.owned_by = request.user
        page.created_by = request.user
        page.updated_by = request.user
        page.is_locked = False
        page.archived_at = None
        page.save()

        page_transaction.delay(
            new_description_html=page.description_html,
            old_description_html=None,
            page_id=page.id,
        )
        copy_s3_objects_of_description_and_assets.delay(
            entity_name="PAGE",
            entity_identifier=page.id,
            project_id=None,
            slug=slug,
            user_id=request.user.id,
        )
        return Response(WikiPageDetailSerializer(page).data, status=status.HTTP_201_CREATED)
