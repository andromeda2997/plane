# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Wiederverwendbare Abfragen für Meilensteine (API und Kalender-Feed)."""

from django.db.models import Count, IntegerField, OuterRef, Subquery, Value
from django.db.models.functions import Coalesce

from plane.db.models import Issue

from .models import Milestone


def _count(queryset):
    """Anzahl der Arbeitselemente je Meilenstein als korrelierte Unterabfrage."""
    return Coalesce(
        Subquery(
            queryset.order_by()
            .values("ext_milestone_issues__milestone_id")
            .annotate(cnt=Count("pk", distinct=True))
            .values("cnt")[:1],
            output_field=IntegerField(),
        ),
        Value(0),
    )


def annotate_progress(queryset):
    """Ergänzt ``total_issues``, ``completed_issues`` und ``cancelled_issues``.

    Gezählt werden wie bei Modulen nur „normale“ Arbeitselemente
    (``Issue.issue_objects``: nicht gelöscht, archiviert, Entwurf oder in Triage);
    abgeschlossen = Status-Gruppe ``completed``, abgebrochen = ``cancelled``.
    """
    linked = Issue.issue_objects.filter(
        ext_milestone_issues__milestone_id=OuterRef("pk"),
        ext_milestone_issues__deleted_at__isnull=True,
    )
    return queryset.annotate(
        total_issues=_count(linked),
        completed_issues=_count(linked.filter(state__group="completed")),
        cancelled_issues=_count(linked.filter(state__group="cancelled")),
    )


def annotated_milestones(slug, project_id):
    """Meilensteine eines Projekts mit Fortschritt, nach Datum sortiert."""
    return annotate_progress(Milestone.objects.filter(workspace__slug=slug, project_id=project_id)).order_by(
        "date", "sort_order", "created_at"
    )


def is_closed(total_issues: int, completed_issues: int, cancelled_issues: int) -> bool:
    """Erledigt = es gibt verknüpfte Arbeitselemente und alle sind abgeschlossen/abgebrochen."""
    return total_issues > 0 and completed_issues + cancelled_issues >= total_issues
