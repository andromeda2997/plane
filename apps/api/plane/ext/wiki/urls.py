# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from .constants import LIVE_COMPAT_PROJECT_SEGMENT
from .views import (
    WikiPageAccessEndpoint,
    WikiPageArchiveEndpoint,
    WikiPageDescriptionEndpoint,
    WikiPageDetailEndpoint,
    WikiPageDuplicateEndpoint,
    WikiPageListEndpoint,
    WikiPageLockEndpoint,
    WikiPagePositionEndpoint,
    ProjectPagePositionEndpoint,
    WikiPageVersionEndpoint,
)

# Eingebunden unter "api/" (siehe plane/urls.py)
PREFIX = "workspaces/<str:slug>/pages/"
# Kompatibilitäts-Alias für den unveränderten Live-Server (siehe constants.py).
# Nur die Pfade, die apps/live während der Zusammenarbeit aufruft.
LIVE_PREFIX = f"workspaces/<str:slug>/projects/{LIVE_COMPAT_PROJECT_SEGMENT}/pages/"

urlpatterns = [
    path(PREFIX, WikiPageListEndpoint.as_view(), name="wiki-pages"),
    path(f"{PREFIX}<uuid:page_id>/", WikiPageDetailEndpoint.as_view(), name="wiki-page-detail"),
    path(f"{PREFIX}<uuid:page_id>/archive/", WikiPageArchiveEndpoint.as_view(), name="wiki-page-archive"),
    path(f"{PREFIX}<uuid:page_id>/lock/", WikiPageLockEndpoint.as_view(), name="wiki-page-lock"),
    path(f"{PREFIX}<uuid:page_id>/access/", WikiPageAccessEndpoint.as_view(), name="wiki-page-access"),
    path(
        f"{PREFIX}<uuid:page_id>/description/",
        WikiPageDescriptionEndpoint.as_view(),
        name="wiki-page-description",
    ),
    path(f"{PREFIX}<uuid:page_id>/versions/", WikiPageVersionEndpoint.as_view(), name="wiki-page-versions"),
    path(
        f"{PREFIX}<uuid:page_id>/versions/<uuid:pk>/",
        WikiPageVersionEndpoint.as_view(),
        name="wiki-page-version-detail",
    ),
    path(f"{PREFIX}<uuid:page_id>/duplicate/", WikiPageDuplicateEndpoint.as_view(), name="wiki-page-duplicate"),
    # Verschieben + Sortieren (Drag-and-Drop im Seitenbaum)
    # "position" statt "move": .../pages/<id>/move/ ist im Upstream-Frontend für "in anderes Projekt" belegt
    path(f"{PREFIX}<uuid:page_id>/position/", WikiPagePositionEndpoint.as_view(), name="wiki-page-position"),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/position/",
        ProjectPagePositionEndpoint.as_view(),
        name="project-page-position",
    ),
    # Live-Server-Alias
    path(f"{LIVE_PREFIX}<uuid:page_id>/", WikiPageDetailEndpoint.as_view(), name="wiki-live-page-detail"),
    path(
        f"{LIVE_PREFIX}<uuid:page_id>/description/",
        WikiPageDescriptionEndpoint.as_view(),
        name="wiki-live-page-description",
    ),
]
