# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Creation of work items from recurring rules (services + celery task)."""

from datetime import date, datetime, timedelta, timezone as dt_timezone
from unittest import mock

import pytest

from plane.db.models import (
    Cycle,
    CycleIssue,
    Issue,
    IssueAssignee,
    IssueLabel,
    Label,
    Module,
    ModuleIssue,
    Project,
    ProjectMember,
    State,
)
from plane.ext.recurring import services
from plane.ext.recurring.models import RecurringWorkItem, RecurringWorkItemRun
from plane.ext.recurring.tasks import create_recurring_work_items


@pytest.fixture(autouse=True)
def _mock_background_tasks():
    with (
        mock.patch("plane.ext.recurring.services.issue_activity") as issue_activity,
        mock.patch("plane.ext.recurring.services.model_activity"),
        mock.patch("plane.db.mixins.soft_delete_related_objects"),
    ):
        yield issue_activity


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(
        name="Neubau Kita",
        identifier="KITA",
        workspace=workspace,
        created_by=create_user,
        timezone="Europe/Berlin",
    )
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    return project


@pytest.fixture
def states(project):
    todo = State.objects.create(name="Todo", project=project, group="unstarted", default=True)
    backlog = State.objects.create(name="Backlog", project=project, group="backlog")
    return {"todo": todo, "backlog": backlog}


def make_rule(project, user, **kwargs):
    defaults = dict(
        project=project,
        name="Jour fixe",
        description_html="<p>Agenda</p>",
        priority="high",
        frequency="weekly",
        weekdays=[1],  # Tuesday
        start_date=date(2026, 11, 1),
        created_by=user,
    )
    defaults.update(kwargs)
    rule = RecurringWorkItem(**defaults)
    # 2026-11-01 10:00 Berlin
    services.reschedule(rule, now=datetime(2026, 11, 1, 9, 0, tzinfo=dt_timezone.utc))
    rule.save(disable_auto_set_user=True)
    return rule


# Tuesday 2026-11-03, 06:00 Berlin = 05:00 UTC
FIRST_RUN = datetime(2026, 11, 3, 5, 0, tzinfo=dt_timezone.utc)


@pytest.mark.unit
@pytest.mark.django_db
class TestSchedule:
    def test_reschedule_uses_project_timezone(self, project, create_user):
        rule = make_rule(project, create_user)
        assert rule.next_occurrence_date == date(2026, 11, 3)
        assert rule.next_run_at == FIRST_RUN

    def test_reschedule_does_not_create_past_occurrences(self, project, create_user):
        rule = make_rule(project, create_user, start_date=date(2026, 1, 1))
        assert rule.next_occurrence_date == date(2026, 11, 3)

    def test_paused_rule_has_no_next_run(self, project, create_user):
        rule = make_rule(project, create_user, is_active=False)
        assert rule.next_run_at is None


@pytest.mark.unit
@pytest.mark.django_db(transaction=True)
class TestProcessRule:
    def test_not_due_yet(self, project, states, create_user):
        rule = make_rule(project, create_user)
        assert services.process_rule(rule.id, now=FIRST_RUN - timedelta(minutes=1)) == []
        assert Issue.objects.filter(project=project).count() == 0

    def test_creates_work_item_and_advances(self, project, states, create_user, _mock_background_tasks):
        label = Label.objects.create(name="Bau", project=project)
        rule = make_rule(project, create_user, state=states["backlog"], duration_days=2)
        rule.labels.set([label])
        rule.assignees.set([create_user])

        runs = services.process_rule(rule.id, now=FIRST_RUN + timedelta(minutes=3))

        assert len(runs) == 1
        run = runs[0]
        assert run.status == RecurringWorkItemRun.STATUS_SUCCESS
        issue = Issue.objects.get(pk=run.issue_id)
        assert issue.name == "Jour fixe"
        assert issue.priority == "high"
        assert issue.state_id == states["backlog"].id
        assert issue.sequence_id == 1
        assert issue.start_date == date(2026, 11, 3)
        assert issue.target_date == date(2026, 11, 4)
        assert issue.created_by_id == create_user.id
        assert IssueAssignee.objects.filter(issue=issue, assignee=create_user).exists()
        assert IssueLabel.objects.filter(issue=issue, label=label).exists()
        # activity is sent after commit
        types = [c.kwargs["type"] for c in _mock_background_tasks.delay.call_args_list]
        assert "issue.activity.created" in types

        rule.refresh_from_db()
        assert rule.occurrence_count == 1
        assert rule.last_occurrence_date == date(2026, 11, 3)
        assert rule.next_occurrence_date == date(2026, 11, 10)
        assert rule.created_by_id == create_user.id

    def test_running_twice_does_not_duplicate(self, project, states, create_user):
        rule = make_rule(project, create_user)
        now = FIRST_RUN + timedelta(minutes=1)
        services.process_rule(rule.id, now=now)
        services.process_rule(rule.id, now=now)
        # the beat task itself, at the same point in time
        with mock.patch("django.utils.timezone.now", return_value=now):
            assert create_recurring_work_items.apply().get() == 0
        assert (
            RecurringWorkItemRun.objects.filter(
                recurring_work_item=rule, occurrence_date=date(2026, 11, 3), status="success"
            ).count()
            == 1
        )
        assert Issue.objects.filter(project=project).count() == 1

    def test_beat_task_processes_due_rules(self, project, states, create_user):
        make_rule(project, create_user)
        make_rule(project, create_user, name="Baustellenbegehung")
        with mock.patch("django.utils.timezone.now", return_value=FIRST_RUN + timedelta(minutes=5)):
            assert create_recurring_work_items.apply().get() == 2
        assert set(Issue.objects.filter(project=project).values_list("name", flat=True)) == {
            "Jour fixe",
            "Baustellenbegehung",
        }

    def test_existing_run_log_prevents_duplicate(self, project, states, create_user):
        """Simulates a restart after the work item was created but before the schedule was saved."""
        rule = make_rule(project, create_user)
        RecurringWorkItemRun.objects.create(
            recurring_work_item=rule, project=project, occurrence_date=date(2026, 11, 3), status="success"
        )
        runs = services.process_rule(rule.id, now=FIRST_RUN + timedelta(minutes=1))
        assert runs == []
        assert Issue.objects.filter(project=project).count() == 0
        rule.refresh_from_db()
        assert rule.next_occurrence_date == date(2026, 11, 10)

    def test_missed_occurrences_are_skipped(self, project, states, create_user):
        rule = make_rule(project, create_user)
        # beat was down for two weeks: Nov 3 and Nov 10 are over, Nov 17 is due today
        now = datetime(2026, 11, 17, 7, 0, tzinfo=dt_timezone.utc)
        runs = services.process_rule(rule.id, now=now)
        assert [r.occurrence_date for r in runs] == [date(2026, 11, 17)]
        rule.refresh_from_db()
        assert rule.next_occurrence_date == date(2026, 11, 24)
        assert rule.occurrence_count == 1

    def test_days_before_creates_ahead(self, project, states, create_user):
        rule = make_rule(project, create_user, create_days_before=2, duration_days=1)
        # Tuesday 2026-11-03 minus 2 days = Sunday 2026-11-01 06:00 Berlin = 05:00 UTC
        assert rule.next_run_at == datetime(2026, 11, 1, 5, 0, tzinfo=dt_timezone.utc)
        runs = services.process_rule(rule.id, now=datetime(2026, 11, 1, 9, 30, tzinfo=dt_timezone.utc))
        assert len(runs) == 1
        assert Issue.objects.get(pk=runs[0].issue_id).start_date == date(2026, 11, 3)

    def test_end_after_count(self, project, states, create_user):
        rule = make_rule(
            project, create_user, frequency="daily", weekdays=[], end_type="after_count", max_occurrences=2
        )
        assert rule.next_occurrence_date == date(2026, 11, 1)
        services.process_rule(rule.id, now=datetime(2026, 11, 1, 6, 0, tzinfo=dt_timezone.utc))
        services.process_rule(rule.id, now=datetime(2026, 11, 2, 6, 0, tzinfo=dt_timezone.utc))
        rule.refresh_from_db()
        assert rule.occurrence_count == 2
        assert rule.next_occurrence_date is None
        assert rule.next_run_at is None

    def test_deleted_label_and_state_do_not_break_creation(self, project, states, create_user):
        label = Label.objects.create(name="Alt", project=project)
        rule = make_rule(project, create_user, state=states["backlog"])
        rule.labels.set([label])
        label.delete()
        State.objects.filter(pk=states["backlog"].id).update(deleted_at=FIRST_RUN)

        runs = services.process_rule(rule.id, now=FIRST_RUN + timedelta(minutes=1))
        assert runs[0].status == "success"
        # soft-deleted labels are hidden by the M2M manager and silently dropped
        assert "state_not_found" in runs[0].warnings
        issue = Issue.objects.get(pk=runs[0].issue_id)
        assert issue.state_id == states["todo"].id
        assert not IssueLabel.objects.filter(issue=issue).exists()

    def test_failure_is_logged_and_schedule_advances(self, project, states, create_user):
        rule = make_rule(project, create_user)
        with mock.patch.object(services, "_create_issue", side_effect=RuntimeError("boom")):
            runs = services.process_rule(rule.id, now=FIRST_RUN + timedelta(minutes=1))
        assert runs[0].status == "failed"
        assert "boom" in runs[0].error
        assert Issue.objects.filter(project=project).count() == 0
        rule.refresh_from_db()
        assert rule.occurrence_count == 0
        assert rule.next_occurrence_date == date(2026, 11, 10)

    def test_cycle_and_module_are_assigned(self, project, states, create_user):
        cycle = Cycle.objects.create(name="KW 45", project=project, owned_by=create_user)
        module = Module.objects.create(name="Rohbau", project=project)
        rule = make_rule(project, create_user, cycle=cycle, module=module)
        runs = services.process_rule(rule.id, now=FIRST_RUN + timedelta(minutes=1))
        issue_id = runs[0].issue_id
        assert CycleIssue.objects.filter(cycle=cycle, issue_id=issue_id).exists()
        assert ModuleIssue.objects.filter(module=module, issue_id=issue_id).exists()

    def test_completed_cycle_is_skipped(self, project, states, create_user):
        cycle = Cycle.objects.create(
            name="Alt",
            project=project,
            owned_by=create_user,
            start_date=datetime(2026, 1, 1, tzinfo=dt_timezone.utc),
            end_date=datetime(2026, 1, 14, tzinfo=dt_timezone.utc),
        )
        rule = make_rule(project, create_user, cycle=cycle)
        runs = services.process_rule(rule.id, now=FIRST_RUN + timedelta(minutes=1))
        assert runs[0].status == "success"
        assert "cycle_completed" in runs[0].warnings
        assert not CycleIssue.objects.filter(issue_id=runs[0].issue_id).exists()

    def test_archived_project_is_ignored(self, project, states, create_user):
        rule = make_rule(project, create_user)
        Project.objects.filter(pk=project.id).update(archived_at=FIRST_RUN)
        assert services.process_rule(rule.id, now=FIRST_RUN + timedelta(minutes=1)) == []

    def test_paused_rule_is_ignored(self, project, states, create_user):
        rule = make_rule(project, create_user)
        RecurringWorkItem.objects.filter(pk=rule.id).update(is_active=False)
        assert services.process_due_rules(now=FIRST_RUN + timedelta(minutes=1)) == 0

    def test_run_now_does_not_change_schedule(self, project, states, create_user):
        rule = make_rule(project, create_user)
        run = services.run_now(rule, create_user)
        assert run.status == "success"
        assert run.trigger == "manual"
        rule.refresh_from_db()
        assert rule.next_occurrence_date == date(2026, 11, 3)
        assert rule.occurrence_count == 0
        # a second manual run on the same day is allowed
        assert services.run_now(rule, create_user).status == "success"
