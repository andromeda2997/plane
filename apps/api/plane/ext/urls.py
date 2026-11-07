# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Sammelt die URLs aller Fork-Erweiterungen (eingebunden unter ``api/``)."""

from django.urls import include, path

urlpatterns = [
    path("", include("plane.ext.recurring.urls")),
    path("", include("plane.ext.wiki.urls")),
    path("", include("plane.ext.calendar_feed.urls")),
    path("", include("plane.ext.milestones.urls")),
]
