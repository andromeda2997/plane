# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Eingebunden unter ``api/`` (über plane/ext/urls.py).

from django.urls import path

from .views import (
    IssueMilestonesEndpoint,
    MilestoneDetailEndpoint,
    MilestoneIssueDetailEndpoint,
    MilestoneIssuesEndpoint,
    MilestoneListEndpoint,
)

PROJECT = "workspaces/<str:slug>/projects/<uuid:project_id>"

urlpatterns = [
    path(f"{PROJECT}/milestones/", MilestoneListEndpoint.as_view(), name="ext-milestones-list"),
    path(f"{PROJECT}/milestones/<uuid:pk>/", MilestoneDetailEndpoint.as_view(), name="ext-milestones-detail"),
    path(
        f"{PROJECT}/milestones/<uuid:pk>/issues/",
        MilestoneIssuesEndpoint.as_view(),
        name="ext-milestones-issues",
    ),
    path(
        f"{PROJECT}/milestones/<uuid:pk>/issues/<uuid:issue_id>/",
        MilestoneIssueDetailEndpoint.as_view(),
        name="ext-milestones-issue-detail",
    ),
    path(
        f"{PROJECT}/issues/<uuid:issue_id>/milestones/",
        IssueMilestonesEndpoint.as_view(),
        name="ext-milestones-issue-milestones",
    ),
]
