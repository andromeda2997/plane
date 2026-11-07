# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q

# Module imports
from plane.db.models.project import ProjectBaseModel

from . import schedule


class RecurringWorkItem(ProjectBaseModel):
    """Template + recurrence rule from which work items are created automatically."""

    FREQUENCY_CHOICES = (
        (schedule.FREQUENCY_DAILY, "Daily"),
        (schedule.FREQUENCY_WEEKLY, "Weekly"),
        (schedule.FREQUENCY_MONTHLY, "Monthly"),
    )
    END_TYPE_CHOICES = (
        (schedule.END_NEVER, "Never"),
        (schedule.END_ON_DATE, "On date"),
        (schedule.END_AFTER_COUNT, "After count"),
    )
    PRIORITY_CHOICES = (
        ("urgent", "Urgent"),
        ("high", "High"),
        ("medium", "Medium"),
        ("low", "Low"),
        ("none", "None"),
    )

    # template
    name = models.CharField(max_length=255)
    description_html = models.TextField(blank=True, default="<p></p>")
    priority = models.CharField(max_length=30, choices=PRIORITY_CHOICES, default="none")
    state = models.ForeignKey(
        "db.State", on_delete=models.SET_NULL, null=True, blank=True, related_name="recurring_work_items"
    )
    assignees = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="recurring_work_items")
    labels = models.ManyToManyField("db.Label", blank=True, related_name="recurring_work_items")
    cycle = models.ForeignKey(
        "db.Cycle", on_delete=models.SET_NULL, null=True, blank=True, related_name="recurring_work_items"
    )
    module = models.ForeignKey(
        "db.Module", on_delete=models.SET_NULL, null=True, blank=True, related_name="recurring_work_items"
    )
    # Duration in days: start_date = occurrence, target_date = occurrence + (duration - 1). Empty = no dates.
    duration_days = models.PositiveIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(3650)]
    )

    # rule
    frequency = models.CharField(max_length=20, choices=FREQUENCY_CHOICES, default=schedule.FREQUENCY_WEEKLY)
    interval = models.PositiveSmallIntegerField(default=1, validators=[MinValueValidator(1), MaxValueValidator(365)])
    # 0 = Monday ... 6 = Sunday
    weekdays = models.JSONField(default=list, blank=True)
    month_day = models.PositiveSmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(31)]
    )
    # create the work item n days before the occurrence date
    create_days_before = models.PositiveSmallIntegerField(default=0, validators=[MaxValueValidator(365)])
    start_date = models.DateField()
    end_type = models.CharField(max_length=20, choices=END_TYPE_CHOICES, default=schedule.END_NEVER)
    end_date = models.DateField(null=True, blank=True)
    max_occurrences = models.PositiveIntegerField(null=True, blank=True, validators=[MinValueValidator(1)])

    # state of the schedule
    is_active = models.BooleanField(default=True)
    next_occurrence_date = models.DateField(null=True, blank=True)
    next_run_at = models.DateTimeField(null=True, blank=True, db_index=True)
    last_occurrence_date = models.DateField(null=True, blank=True)
    last_run_at = models.DateTimeField(null=True, blank=True)
    occurrence_count = models.PositiveIntegerField(default=0)

    class Meta:
        verbose_name = "Recurring Work Item"
        verbose_name_plural = "Recurring Work Items"
        db_table = "ext_recurring_work_items"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.name} <{self.project_id}>"

    def to_rule(self) -> schedule.RecurrenceRule:
        return schedule.RecurrenceRule(
            frequency=self.frequency,
            start_date=self.start_date,
            interval=self.interval or 1,
            weekdays=list(self.weekdays or []),
            month_day=self.month_day,
            end_type=self.end_type,
            end_date=self.end_date,
            max_occurrences=self.max_occurrences,
        )


class RecurringWorkItemRun(ProjectBaseModel):
    """Log entry for every attempt to create a work item from a recurring rule."""

    STATUS_SUCCESS = "success"
    STATUS_FAILED = "failed"
    STATUS_CHOICES = ((STATUS_SUCCESS, "Success"), (STATUS_FAILED, "Failed"))

    TRIGGER_SCHEDULED = "scheduled"
    TRIGGER_MANUAL = "manual"
    TRIGGER_CHOICES = ((TRIGGER_SCHEDULED, "Scheduled"), (TRIGGER_MANUAL, "Manual"))

    recurring_work_item = models.ForeignKey(RecurringWorkItem, on_delete=models.CASCADE, related_name="runs")
    issue = models.ForeignKey(
        "db.Issue", on_delete=models.SET_NULL, null=True, blank=True, related_name="recurring_work_item_runs"
    )
    occurrence_date = models.DateField()
    trigger = models.CharField(max_length=20, choices=TRIGGER_CHOICES, default=TRIGGER_SCHEDULED)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_SUCCESS)
    error = models.TextField(blank=True, default="")
    warnings = models.JSONField(default=list, blank=True)

    class Meta:
        verbose_name = "Recurring Work Item Run"
        verbose_name_plural = "Recurring Work Item Runs"
        db_table = "ext_recurring_work_item_runs"
        ordering = ("-created_at",)
        constraints = [
            # A scheduled occurrence must never create two work items (idempotency guard).
            models.UniqueConstraint(
                fields=["recurring_work_item", "occurrence_date"],
                condition=Q(trigger="scheduled", status="success", deleted_at__isnull=True),
                name="ext_recurring_run_unique_scheduled_occurrence",
            )
        ]

    def __str__(self):
        return f"{self.recurring_work_item_id} {self.occurrence_date} {self.status}"
