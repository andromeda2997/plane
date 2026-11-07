# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.apps import AppConfig


class RecurringConfig(AppConfig):
    name = "plane.ext.recurring"
    # Fest, NIE ändern: Migrationen und Tabellennamen hängen daran.
    label = "ext_recurring"
    verbose_name = "Recurring work items"
    default_auto_field = "django.db.models.BigAutoField"
