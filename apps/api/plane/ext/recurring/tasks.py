# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from celery import shared_task

# Module imports
from plane.utils.exception_logger import log_exception


@shared_task(name="plane.ext.recurring.tasks.create_recurring_work_items")
def create_recurring_work_items():
    """Celery beat entry point: create work items for all due recurring rules."""
    from .services import process_due_rules

    try:
        return process_due_rules()
    except Exception as e:
        log_exception(e)
        return 0
