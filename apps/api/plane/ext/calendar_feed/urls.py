# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Eingebunden unter ``api/`` (über plane/ext/urls.py).

from django.urls import path, re_path

from .views import (
    PublicCalendarFeedEndpoint,
    UserCalendarFeedsEndpoint,
    WorkspaceCalendarFeedDetailEndpoint,
    WorkspaceCalendarFeedRegenerateEndpoint,
    WorkspaceCalendarFeedsEndpoint,
)

urlpatterns = [
    # Öffentlich (ohne Login): Token aus secrets.token_urlsafe → [A-Za-z0-9_-].
    re_path(
        r"^calendar-feeds/(?P<token>[A-Za-z0-9_-]{32,128})\.ics$",
        PublicCalendarFeedEndpoint.as_view(),
        name="ext-calendar-feed-public",
    ),
    path(
        "users/me/calendar-feeds/",
        UserCalendarFeedsEndpoint.as_view(),
        name="ext-calendar-feed-user-list",
    ),
    path(
        "workspaces/<str:slug>/calendar-feeds/",
        WorkspaceCalendarFeedsEndpoint.as_view(),
        name="ext-calendar-feed-list",
    ),
    path(
        "workspaces/<str:slug>/calendar-feeds/<uuid:pk>/",
        WorkspaceCalendarFeedDetailEndpoint.as_view(),
        name="ext-calendar-feed-detail",
    ),
    path(
        "workspaces/<str:slug>/calendar-feeds/<uuid:pk>/regenerate/",
        WorkspaceCalendarFeedRegenerateEndpoint.as_view(),
        name="ext-calendar-feed-regenerate",
    ),
]
