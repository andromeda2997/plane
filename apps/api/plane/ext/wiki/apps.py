# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.apps import AppConfig


class WikiConfig(AppConfig):
    """Workspace-Wiki ("Wiki light"): Seiten ohne Projekt auf Workspace-Ebene.

    Nutzt ausschließlich das bestehende Page-Modell (is_global=True, keine
    ProjectPage-Zuordnung) und legt keine eigenen Tabellen an.
    """

    name = "plane.ext.wiki"
    label = "plane_ext_wiki"
    verbose_name = "Wiki"
