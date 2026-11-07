# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.apps import AppConfig


class MilestonesConfig(AppConfig):
    name = "plane.ext.milestones"
    # Fest, NIE ändern: Migrationen und Tabellennamen hängen daran.
    label = "ext_milestones"
    verbose_name = "Milestones"
    default_auto_field = "django.db.models.BigAutoField"
