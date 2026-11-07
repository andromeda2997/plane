# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import models
from django.db.models import Q

from plane.db.models.project import ProjectBaseModel

# Kleine Standard-Palette (identisch im Frontend: MILESTONE_COLORS).
MILESTONE_COLORS = [
    "#3F76FF",  # Blau
    "#16A34A",  # Grün
    "#F59E0B",  # Bernstein
    "#9333EA",  # Violett
    "#0EA5E9",  # Himmelblau
    "#EC4899",  # Pink
    "#64748B",  # Schiefer
]
DEFAULT_MILESTONE_COLOR = MILESTONE_COLORS[0]
MILESTONE_DESCRIPTION_MAX_LENGTH = 2000


class Milestone(ProjectBaseModel):
    """Ein Stichtag im Projekt (z. B. Abschluss einer HOAI-Leistungsphase).

    Soft-Delete wie in Plane (``deleted_at``); die Verknüpfungen zu
    Arbeitselementen liegen in :class:`MilestoneIssue`.
    """

    # Felder aus ProjectBaseModel mit eigenem related_name überschrieben,
    # damit sie nie mit (künftigen) Upstream-Modellen kollidieren.
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="ext_milestones")
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="ext_milestones")

    name = models.CharField(max_length=255)
    date = models.DateField()
    description = models.TextField(blank=True, default="")
    color = models.CharField(max_length=7, default=DEFAULT_MILESTONE_COLOR)
    sort_order = models.FloatField(default=65535)

    class Meta:
        db_table = "ext_milestones_milestone"
        verbose_name = "Milestone"
        verbose_name_plural = "Milestones"
        ordering = ("date", "sort_order", "created_at")

    def __str__(self):
        return f"{self.name} ({self.date})"


class MilestoneIssue(ProjectBaseModel):
    """Zwischentabelle Meilenstein ↔ Arbeitselement (Soft-Delete wie ModuleIssue)."""

    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="ext_milestone_issues")
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="ext_milestone_issues")

    milestone = models.ForeignKey(Milestone, on_delete=models.CASCADE, related_name="milestone_issues")
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="ext_milestone_issues")

    class Meta:
        db_table = "ext_milestones_milestone_issue"
        verbose_name = "Milestone Issue"
        verbose_name_plural = "Milestone Issues"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["milestone", "issue"],
                condition=Q(deleted_at__isnull=True),
                name="ext_milestone_issue_unique_when_deleted_at_null",
            )
        ]

    def __str__(self):
        return f"{self.milestone_id} {self.issue_id}"
