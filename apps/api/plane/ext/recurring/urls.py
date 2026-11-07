# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from .views import RecurringWorkItemViewSet

BASE = "workspaces/<str:slug>/projects/<uuid:project_id>/recurring-work-items/"

urlpatterns = [
    path(
        BASE,
        RecurringWorkItemViewSet.as_view({"get": "list", "post": "create"}),
        name="project-recurring-work-items",
    ),
    path(
        BASE + "<uuid:pk>/",
        RecurringWorkItemViewSet.as_view({"get": "retrieve", "patch": "partial_update", "delete": "destroy"}),
        name="project-recurring-work-item",
    ),
    path(
        BASE + "<uuid:pk>/pause/",
        RecurringWorkItemViewSet.as_view({"post": "pause"}),
        name="project-recurring-work-item-pause",
    ),
    path(
        BASE + "<uuid:pk>/resume/",
        RecurringWorkItemViewSet.as_view({"post": "resume"}),
        name="project-recurring-work-item-resume",
    ),
    path(
        BASE + "<uuid:pk>/run/",
        RecurringWorkItemViewSet.as_view({"post": "run"}),
        name="project-recurring-work-item-run",
    ),
    path(
        BASE + "<uuid:pk>/runs/",
        RecurringWorkItemViewSet.as_view({"get": "runs"}),
        name="project-recurring-work-item-runs",
    ),
]
