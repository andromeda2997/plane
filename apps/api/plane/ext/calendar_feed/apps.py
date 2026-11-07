# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.apps import AppConfig


class CalendarFeedConfig(AppConfig):
    name = "plane.ext.calendar_feed"
    # Fest, NIE ändern: Migrationen und Tabellennamen hängen daran.
    label = "ext_calendar_feed"
    verbose_name = "Calendar feeds (ICS)"
    default_auto_field = "django.db.models.BigAutoField"
