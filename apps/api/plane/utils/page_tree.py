# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Hilfsfunktionen für verschachtelte Seiten (Page.parent).

Wird von den Projekt-Seiten-Views und vom Workspace-Wiki (plane.ext.wiki)
gemeinsam genutzt.
"""

# Django imports
from django.core.exceptions import ValidationError
from django.db import connection
from django.db.models import Q

# Module imports
from plane.db.models import Page


def get_descendant_page_ids(page_id):
    """Alle (nicht gelöschten) Nachfahren einer Seite, ohne die Seite selbst."""
    sql = """
    WITH RECURSIVE descendants AS (
        SELECT id FROM pages WHERE parent_id = %s AND deleted_at IS NULL
        UNION
        SELECT pages.id FROM pages
        JOIN descendants ON pages.parent_id = descendants.id
        WHERE pages.deleted_at IS NULL
    )
    SELECT id FROM descendants;
    """
    with connection.cursor() as cursor:
        cursor.execute(sql, [str(page_id)])
        return [row[0] for row in cursor.fetchall()]


def is_invalid_parent(page_id, parent_id):
    """True, wenn parent_id die Seite selbst oder einer ihrer Nachfahren ist
    (das Verschieben würde einen Zyklus erzeugen)."""
    if parent_id is None:
        return False
    if str(page_id) == str(parent_id):
        return True
    return str(parent_id) in {str(pk) for pk in get_descendant_page_ids(page_id)}


def get_project_parent_page(slug, project_id, parent_id, user):
    """Übergeordnete Seite im selben Projekt (aktive Projektzuordnung,
    nicht archiviert, für den Nutzer sichtbar) oder None."""
    try:
        return Page.objects.filter(
            Q(owned_by=user) | Q(access=Page.PUBLIC_ACCESS),
            pk=parent_id,
            workspace__slug=slug,
            project_pages__project_id=project_id,
            project_pages__deleted_at__isnull=True,
            archived_at__isnull=True,
        ).first()
    except (ValidationError, ValueError):
        # ungültige UUID
        return None
