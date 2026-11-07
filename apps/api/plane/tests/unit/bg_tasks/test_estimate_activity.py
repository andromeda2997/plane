# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Unit tests for track_estimate_points (issue activity for estimates).

Removing an estimate used to raise AttributeError because the activity field
was derived from the (missing) new estimate point.
"""

from uuid import uuid4

import pytest
from django.utils import timezone

from plane.bgtasks.issue_activities_task import track_estimate_points
from plane.db.models import Estimate, EstimatePoint
from plane.tests.factories import ProjectFactory


@pytest.fixture
def project(db):
    return ProjectFactory()


def _make_point(project, estimate_type, value, key=1):
    estimate = Estimate.objects.create(name=f"{estimate_type}-{uuid4().hex[:6]}", type=estimate_type, project=project)
    return EstimatePoint.objects.create(estimate=estimate, key=key, value=value, project=project)


def _track(project, old_point_id, new_point_id):
    activities = []
    track_estimate_points(
        requested_data={"estimate_point": new_point_id},
        current_instance={"estimate_point": old_point_id},
        issue_id=uuid4(),
        project_id=project.id,
        workspace_id=project.workspace_id,
        actor_id=project.created_by_id,
        issue_activities=activities,
        epoch=0,
    )
    return activities


@pytest.mark.unit
class TestTrackEstimatePoints:
    def test_remove_time_estimate_uses_type_of_old_estimate(self, project):
        point = _make_point(project, "time", "90")

        activities = _track(project, str(point.id), None)

        assert len(activities) == 1
        activity = activities[0]
        assert activity.verb == "removed"
        assert activity.field == "estimate_time"
        assert activity.old_value == "90"
        assert activity.new_value is None
        assert str(activity.old_identifier) == str(point.id)

    def test_remove_points_estimate(self, project):
        point = _make_point(project, "points", "3")

        activity = _track(project, str(point.id), None)[0]

        assert activity.verb == "removed"
        assert activity.field == "estimate_points"
        assert activity.old_value == "3"

    def test_update_estimate_uses_type_of_new_estimate(self, project):
        old_point = _make_point(project, "time", "30", key=1)
        new_point = EstimatePoint.objects.create(estimate=old_point.estimate, key=2, value="60", project=project)

        activity = _track(project, str(old_point.id), str(new_point.id))[0]

        assert activity.verb == "updated"
        assert activity.field == "estimate_time"
        assert activity.old_value == "30"
        assert activity.new_value == "60"

    def test_remove_soft_deleted_estimate_point_falls_back_to_legacy_field(self, project):
        point = _make_point(project, "time", "45")
        # soft delete: no longer visible via EstimatePoint.objects
        EstimatePoint.objects.filter(pk=point.pk).update(deleted_at=timezone.now())

        activity = _track(project, str(point.id), None)[0]

        assert activity.verb == "removed"
        assert activity.field == "estimate_point"
        assert activity.old_value is None

    def test_unchanged_estimate_creates_no_activity(self, project):
        point = _make_point(project, "time", "45")

        assert _track(project, str(point.id), str(point.id)) == []
