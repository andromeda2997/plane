# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Hilfsfunktionen für verschachtelte Seiten (Page.parent).

Wird von den Projekt-Seiten-Views und vom Workspace-Wiki (plane.ext.wiki)
gemeinsam genutzt.
"""

# Python imports
import math
import uuid

# Django imports
from django.core.exceptions import ValidationError
from django.db import connection, transaction
from django.db.models import Max, Q

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


# ---------------------------------------------------------------------------
# Reihenfolge (Page.sort_order) im Seitenbaum
# ---------------------------------------------------------------------------

# Abstand zwischen zwei Seiten beim Anhängen/Neu-Durchnummerieren (wie bei Projekten/Labels).
SORT_ORDER_STEP = 10000
# Obergrenze für die mitgeschickte Reihenfolge einer Geschwistergruppe.
MAX_ORDER_IDS = 2000


def next_sort_order(siblings):
    """sort_order für eine neue Seite am Ende der Geschwister (größter Wert + Schritt).

    siblings: Queryset der Seiten mit derselben übergeordneten Seite im selben
    Bereich (Projekt bzw. Wiki). Ohne Geschwister bleibt der Modell-Standard.
    """
    current_max = siblings.aggregate(value=Max("sort_order"))["value"]
    if current_max is None:
        return Page.DEFAULT_SORT_ORDER
    return current_max + SORT_ORDER_STEP


class PageMoveError(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.message = message


def parse_move_payload(data):
    """Prüft den Körper eines Verschieben/Sortieren-Aufrufs.

    Erwartet: "parent" (UUID oder null = oberste Ebene, Schlüssel ist Pflicht) und
    entweder "sort_order" (endliche Zahl, i. d. R. Mittelwert der neuen Nachbarn) oder
    "order" (vollständige Reihenfolge der Ziel-Geschwistergruppe nach dem Ablegen,
    inkl. der verschobenen Seite; wird genutzt, wenn die Nachbarn denselben Wert haben).
    Gibt (parent_id, sort_order, order_ids) zurück oder wirft PageMoveError.
    """
    if not hasattr(data, "get") or "parent" not in data:
        raise PageMoveError("'parent' is required (use null for the top level)")

    parent_id = data.get("parent") or None
    if parent_id is not None:
        try:
            parent_id = str(uuid.UUID(str(parent_id)))
        except (ValueError, TypeError, AttributeError):
            raise PageMoveError("Invalid parent")

    order_ids = data.get("order", None)
    sort_order = data.get("sort_order", None)

    if order_ids is not None:
        if not isinstance(order_ids, list) or not order_ids or len(order_ids) > MAX_ORDER_IDS:
            raise PageMoveError("'order' must be a non-empty list of page ids")
        try:
            order_ids = [str(uuid.UUID(str(pk))) for pk in order_ids]
        except (ValueError, TypeError, AttributeError):
            raise PageMoveError("'order' contains an invalid page id")
        if len(set(order_ids)) != len(order_ids):
            raise PageMoveError("'order' contains duplicate page ids")
        return parent_id, None, order_ids

    if sort_order is None or isinstance(sort_order, bool):
        raise PageMoveError("'sort_order' or 'order' is required")
    try:
        sort_order = float(sort_order)
    except (ValueError, TypeError):
        raise PageMoveError("Invalid sort_order")
    if not math.isfinite(sort_order):
        raise PageMoveError("Invalid sort_order")
    return parent_id, sort_order, None


def validate_move_target(page, parent_id):
    """Allgemeine Prüfungen für die zu verschiebende Seite (ohne Bereichsprüfung des Ziels)."""
    if page.is_locked:
        raise PageMoveError("Page is locked")
    if page.archived_at is not None:
        raise PageMoveError("Archived pages cannot be moved")
    if is_invalid_parent(page.id, parent_id):
        raise PageMoveError("A page cannot be moved under itself or one of its sub pages")


def apply_page_move(page, parent_id, sort_order, order_ids, scope_pages):
    """Setzt parent und sort_order in einem Schritt (Aufrufer prüft vorher Ziel und Rechte).

    scope_pages: Queryset aller für den Nutzer sichtbaren Seiten im selben Bereich
    (Projekt bzw. Wiki). Bei "order" müssen alle IDs darin liegen und – außer der
    verschobenen Seite – bereits unter parent_id hängen; sie werden mit festem Abstand
    neu durchnummeriert. Gibt {page_id: sort_order} aller geänderten Seiten zurück.
    """
    page_id = str(page.id)
    if order_ids is not None:
        if page_id not in order_ids:
            raise PageMoveError("'order' must contain the moved page")
        rows = {
            str(pk): (str(parent) if parent else None)
            for pk, parent in scope_pages.filter(pk__in=order_ids).values_list("pk", "parent_id")
        }
        if len(rows) != len(order_ids):
            raise PageMoveError("'order' contains pages that are not available here")
        if any(rows[pk] != parent_id for pk in order_ids if pk != page_id):
            raise PageMoveError("'order' contains pages that are not sub pages of the target parent")

    with transaction.atomic():
        changed = {}
        if order_ids is not None:
            pages = {str(p.pk): p for p in Page.objects.filter(pk__in=order_ids)}
            to_update = []
            for index, pk in enumerate(order_ids):
                value = float((index + 1) * SORT_ORDER_STEP)
                target = pages[pk]
                if pk == page_id:
                    continue
                if target.sort_order != value:
                    target.sort_order = value
                    to_update.append(target)
                    changed[pk] = value
            if to_update:
                Page.objects.bulk_update(to_update, ["sort_order"])
            sort_order = float((order_ids.index(page_id) + 1) * SORT_ORDER_STEP)

        page.parent_id = parent_id
        page.sort_order = sort_order
        page.save(update_fields=["parent", "sort_order", "updated_at", "updated_by"])
        changed[page_id] = sort_order
    return changed
