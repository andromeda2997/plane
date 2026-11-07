# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework.permissions import SAFE_METHODS, BasePermission

# Module imports
from plane.app.permissions import ROLE
from plane.db.models import WorkspaceMember


def get_workspace_role(user, slug):
    """Rolle des Nutzers im Workspace (20/15/5) oder None."""
    return (
        WorkspaceMember.objects.filter(member=user, workspace__slug=slug, is_active=True)
        .values_list("role", flat=True)
        .first()
    )


class WorkspaceWikiPermission(BasePermission):
    """Workspace-Wiki: aktive Workspace-Mitglieder dürfen lesen,
    Mitglieder und Admins dürfen schreiben, Gäste nur lesen.

    Private Seiten werden zusätzlich über das Queryset auf den Besitzer
    beschränkt; owner-/admin-Aktionen (Archivieren, Löschen, Sperren,
    Sichtbarkeit) prüfen die Views selbst.
    """

    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False

        role = get_workspace_role(request.user, view.kwargs.get("slug"))
        if role is None:
            return False

        # Rolle für die Views merken (spart weitere Abfragen)
        request.wiki_workspace_role = role

        if request.method in SAFE_METHODS:
            return True

        return role >= ROLE.MEMBER.value
