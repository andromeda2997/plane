# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery-Beat-Einträge aller Fork-Erweiterungen (wird in plane/celery.py eingebunden).

Nur Daten, keine Modelle importieren. Namen nicht ändern: Plane nutzt den
DatabaseScheduler, umbenannte Einträge blieben als Altlast in
django_celery_beat_periodictask stehen.
"""

from celery.schedules import crontab

EXT_BEAT_SCHEDULE = {
    "check-every-fifteen-minutes-to-create-recurring-work-items": {
        "task": "plane.ext.recurring.tasks.create_recurring_work_items",
        "schedule": crontab(minute="*/15"),  # alle 15 Minuten
    },
}
