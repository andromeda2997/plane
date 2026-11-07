# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Scheduling and work item creation for recurring work items."""

# Python imports
import json
import logging
from datetime import date, datetime, timedelta
from typing import Optional

# Django imports
from django.conf import settings
from django.core import serializers as django_serializers
from django.core.serializers.json import DjangoJSONEncoder
from django.db import IntegrityError, transaction
from django.utils import timezone

# Third party imports
from crum import impersonate

# Module imports
from plane.app.serializers import IssueCreateSerializer
from plane.bgtasks.issue_activities_task import issue_activity
from plane.bgtasks.webhook_task import model_activity
from plane.db.models import (
    Cycle,
    CycleIssue,
    Label,
    Module,
    ModuleIssue,
    ProjectMember,
    State,
    User,
)

from . import schedule
from .models import RecurringWorkItem, RecurringWorkItemRun

logger = logging.getLogger("plane.ext.recurring")

# Maximum number of occurrences processed for a single rule in one beat tick.
MAX_OCCURRENCES_PER_TICK = 10

SCHEDULE_FIELDS = [
    "next_occurrence_date",
    "next_run_at",
    "last_occurrence_date",
    "last_run_at",
    "occurrence_count",
    "updated_at",
]


def _origin() -> Optional[str]:
    return getattr(settings, "APP_BASE_URL", None) or getattr(settings, "WEB_URL", None) or None


def _set_next(rule: RecurringWorkItem, occurrence: Optional[date]) -> None:
    rule.next_occurrence_date = occurrence
    rule.next_run_at = (
        schedule.run_at_for(occurrence, rule.project.timezone, rule.create_days_before)
        if occurrence is not None and rule.is_active
        else None
    )


def reschedule(rule: RecurringWorkItem, now: Optional[datetime] = None) -> None:
    """(Re)compute the next occurrence after the rule was created, edited or resumed.

    Starts at max(start date, today in the project timezone, day after the last scheduled
    occurrence), so past occurrences are never created retroactively and an occurrence that
    was already created is never created again. Does not save the rule.
    """
    now = now or timezone.now()
    if not rule.is_active:
        _set_next(rule, None)
        return
    from_date = max(rule.start_date, schedule.local_today(rule.project.timezone, now))
    if rule.last_occurrence_date is not None:
        from_date = max(from_date, rule.last_occurrence_date + timedelta(days=1))
    _set_next(rule, schedule.next_occurrence(rule.to_rule(), from_date, rule.occurrence_count))


def _resolve_actor(rule: RecurringWorkItem, actor: Optional[User]) -> Optional[User]:
    if actor is not None and not actor.is_anonymous:
        return actor
    for user_id in (rule.created_by_id, rule.project.created_by_id):
        if user_id:
            user = User.objects.filter(pk=user_id, is_active=True).first()
            if user:
                return user
    return None


def _build_issue_payload(rule: RecurringWorkItem, occurrence: date, warnings: list) -> dict:
    project_id = rule.project_id
    data = {
        "name": rule.name,
        "description_html": rule.description_html or "<p></p>",
        "priority": rule.priority or "none",
    }

    # state: drop states that were deleted or moved out of the project
    if rule.state_id:
        if State.objects.filter(pk=rule.state_id, project_id=project_id).exists():
            data["state_id"] = str(rule.state_id)
        else:
            warnings.append("state_not_found")

    # labels: only labels that still exist in the project
    label_ids = [str(pk) for pk in rule.labels.values_list("id", flat=True)]
    if label_ids:
        valid_labels = [
            str(pk) for pk in Label.objects.filter(project_id=project_id, id__in=label_ids).values_list("id", flat=True)
        ]
        if len(valid_labels) != len(label_ids):
            warnings.append("labels_not_found")
        if valid_labels:
            data["label_ids"] = valid_labels

    # assignees: only active members of the project (same rule as the issue serializer)
    assignee_ids = [str(pk) for pk in rule.assignees.values_list("id", flat=True)]
    if assignee_ids:
        valid_assignees = [
            str(pk)
            for pk in ProjectMember.objects.filter(
                project_id=project_id, member_id__in=assignee_ids, role__gte=15, is_active=True
            ).values_list("member_id", flat=True)
        ]
        if len(valid_assignees) != len(assignee_ids):
            warnings.append("assignees_not_found")
        if valid_assignees:
            data["assignee_ids"] = valid_assignees

    if rule.duration_days:
        data["start_date"] = occurrence.isoformat()
        data["target_date"] = (occurrence + timedelta(days=rule.duration_days - 1)).isoformat()
    return data


def _create_issue(rule: RecurringWorkItem, occurrence: date, actor: Optional[User], warnings: list):
    """Create the work item through the same serializer the work item API uses."""
    project = rule.project
    data = _build_issue_payload(rule, occurrence, warnings)
    serializer = IssueCreateSerializer(
        data=data,
        context={
            "project_id": project.id,
            "workspace_id": project.workspace_id,
            "default_assignee_id": project.default_assignee_id,
        },
    )
    if not serializer.is_valid():
        raise ValueError(json.dumps(serializer.errors, cls=DjangoJSONEncoder))
    issue = serializer.save()

    actor_id = str(actor.id) if actor else None
    origin = _origin()
    epoch = int(timezone.now().timestamp())
    callbacks = []
    callbacks.append(
        lambda: issue_activity.delay(
            type="issue.activity.created",
            requested_data=json.dumps(data, cls=DjangoJSONEncoder),
            actor_id=actor_id,
            issue_id=str(issue.id),
            project_id=str(project.id),
            current_instance=None,
            epoch=epoch,
            notification=True,
            origin=origin,
        )
    )
    callbacks.append(
        lambda: model_activity.delay(
            model_name="issue",
            model_id=str(issue.id),
            requested_data=data,
            current_instance=None,
            actor_id=actor_id,
            slug=project.workspace.slug,
            origin=origin,
        )
    )

    # cycle (the issue serializer does not handle cycles; same as CycleIssueViewSet.create)
    if rule.cycle_id:
        cycle = Cycle.objects.filter(pk=rule.cycle_id, project_id=project.id, archived_at__isnull=True).first()
        if cycle is None:
            warnings.append("cycle_not_found")
        elif cycle.end_date is not None and cycle.end_date < timezone.now():
            warnings.append("cycle_completed")
        else:
            cycle_issue = CycleIssue.objects.create(
                project_id=project.id,
                workspace_id=project.workspace_id,
                cycle_id=cycle.id,
                issue_id=issue.id,
            )
            created_records = django_serializers.serialize("json", [cycle_issue])
            callbacks.append(
                lambda: issue_activity.delay(
                    type="cycle.activity.created",
                    requested_data=json.dumps({"cycles_list": [str(issue.id)]}),
                    actor_id=actor_id,
                    issue_id=None,
                    project_id=str(project.id),
                    current_instance=json.dumps({"updated_cycle_issues": [], "created_cycle_issues": created_records}),
                    epoch=epoch,
                    notification=True,
                    origin=origin,
                )
            )

    # module (same as ModuleIssueViewSet.create_module_issues)
    if rule.module_id:
        module = Module.objects.filter(pk=rule.module_id, project_id=project.id, archived_at__isnull=True).first()
        if module is None:
            warnings.append("module_not_found")
        else:
            ModuleIssue.objects.create(
                project_id=project.id,
                workspace_id=project.workspace_id,
                module_id=module.id,
                issue_id=issue.id,
            )
            callbacks.append(
                lambda: issue_activity.delay(
                    type="module.activity.created",
                    requested_data=json.dumps({"module_id": str(module.id)}),
                    actor_id=actor_id,
                    issue_id=str(issue.id),
                    project_id=str(project.id),
                    current_instance=None,
                    epoch=epoch,
                    notification=True,
                    origin=origin,
                )
            )

    for callback in callbacks:
        transaction.on_commit(callback)
    return issue


def create_occurrence(
    rule: RecurringWorkItem,
    occurrence: date,
    trigger: str = RecurringWorkItemRun.TRIGGER_SCHEDULED,
    actor: Optional[User] = None,
) -> Optional[RecurringWorkItemRun]:
    """Create one work item for ``occurrence`` and log the attempt.

    Returns the run log entry, or ``None`` if the scheduled occurrence was already created
    (idempotency). Never raises for errors during creation: they are logged on the run.
    """
    is_scheduled = trigger == RecurringWorkItemRun.TRIGGER_SCHEDULED
    if (
        is_scheduled
        and RecurringWorkItemRun.objects.filter(
            recurring_work_item=rule,
            occurrence_date=occurrence,
            trigger=RecurringWorkItemRun.TRIGGER_SCHEDULED,
            status=RecurringWorkItemRun.STATUS_SUCCESS,
        ).exists()
    ):
        return None

    actor = _resolve_actor(rule, actor)
    warnings: list = []
    with impersonate(actor):
        try:
            with transaction.atomic():
                issue = _create_issue(rule, occurrence, actor, warnings)
                return RecurringWorkItemRun.objects.create(
                    recurring_work_item=rule,
                    project_id=rule.project_id,
                    issue=issue,
                    occurrence_date=occurrence,
                    trigger=trigger,
                    status=RecurringWorkItemRun.STATUS_SUCCESS,
                    warnings=warnings,
                )
        except IntegrityError:
            if (
                is_scheduled
                and RecurringWorkItemRun.objects.filter(
                    recurring_work_item=rule,
                    occurrence_date=occurrence,
                    trigger=RecurringWorkItemRun.TRIGGER_SCHEDULED,
                    status=RecurringWorkItemRun.STATUS_SUCCESS,
                ).exists()
            ):
                # created concurrently by another worker
                return None
            logger.exception("Recurring work item %s: integrity error", rule.id)
            error = "integrity_error"
        except Exception as e:  # noqa: BLE001 - every failure must be logged on the run
            logger.exception("Recurring work item %s: creating the work item failed", rule.id)
            error = str(e)[:4000] or e.__class__.__name__

        return RecurringWorkItemRun.objects.create(
            recurring_work_item=rule,
            project_id=rule.project_id,
            occurrence_date=occurrence,
            trigger=trigger,
            status=RecurringWorkItemRun.STATUS_FAILED,
            error=error,
            warnings=warnings,
        )


def _advance(rule: RecurringWorkItem, occurrence: date) -> None:
    following = schedule.next_occurrence(rule.to_rule(), occurrence + timedelta(days=1), rule.occurrence_count)
    _set_next(rule, following)


def process_rule(rule_id, now: Optional[datetime] = None) -> list:
    """Create all due occurrences of one rule. Safe to run concurrently and repeatedly."""
    now = now or timezone.now()
    runs = []
    with transaction.atomic():
        rule = (
            RecurringWorkItem.objects.select_for_update(skip_locked=True, of=("self",))
            .select_related("project", "project__workspace")
            .filter(
                pk=rule_id,
                is_active=True,
                next_run_at__lte=now,
                project__archived_at__isnull=True,
                project__deleted_at__isnull=True,
            )
            .first()
        )
        if rule is None:
            return runs

        today = schedule.local_today(rule.project.timezone, now)
        for _ in range(MAX_OCCURRENCES_PER_TICK):
            occurrence = rule.next_occurrence_date
            if occurrence is None or rule.next_run_at is None or rule.next_run_at > now:
                break
            # Occurrences whose day is already over (e.g. after a downtime) are skipped, not caught up.
            if occurrence >= today:
                run = create_occurrence(rule, occurrence)
                if run is not None:
                    runs.append(run)
                    if run.status == RecurringWorkItemRun.STATUS_SUCCESS:
                        rule.occurrence_count += 1
                    rule.last_run_at = now
            rule.last_occurrence_date = occurrence
            _advance(rule, occurrence)

        rule.save(update_fields=SCHEDULE_FIELDS, disable_auto_set_user=True)
    return runs


def process_due_rules(now: Optional[datetime] = None) -> int:
    """Process every due rule; returns the number of created work items."""
    now = now or timezone.now()
    rule_ids = list(
        RecurringWorkItem.objects.filter(
            is_active=True,
            next_run_at__lte=now,
            project__archived_at__isnull=True,
            project__deleted_at__isnull=True,
        )
        .order_by("next_run_at")
        .values_list("id", flat=True)
    )
    created = 0
    for rule_id in rule_ids:
        try:
            runs = process_rule(rule_id, now=now)
            created += sum(1 for run in runs if run.status == RecurringWorkItemRun.STATUS_SUCCESS)
        except Exception:  # noqa: BLE001 - one broken rule must not block the others
            logger.exception("Recurring work item %s: processing failed", rule_id)
    return created


def run_now(rule: RecurringWorkItem, actor: Optional[User]) -> RecurringWorkItemRun:
    """Manually create a work item for today (project timezone). Does not change the schedule."""
    today = schedule.local_today(rule.project.timezone, timezone.now())
    with transaction.atomic():
        run = create_occurrence(rule, today, trigger=RecurringWorkItemRun.TRIGGER_MANUAL, actor=actor)
        RecurringWorkItem.objects.filter(pk=rule.pk).update(last_run_at=timezone.now())
    return run
