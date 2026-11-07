# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import hashlib
import secrets

from django.conf import settings
from django.db import models
from django.db.models import Q

from plane.db.models.base import BaseModel


# 32 Byte Zufall → 43 Zeichen URL-sicheres Base64 (256 Bit Entropie).
TOKEN_BYTES = 32
TOKEN_PREFIX_LENGTH = 6


def generate_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def hash_token(token: str) -> str:
    """SHA-256 (hex) des Klartext-Tokens. Nur der Hash wird gespeichert."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class CalendarFeedScope(models.TextChoices):
    PROJECT = "project", "Project"
    MY_WORK_ITEMS = "my_work_items", "My work items"


class CalendarFeed(BaseModel):
    """Ein abonnierbarer ICS-Feed eines Nutzers.

    Bereich: ein Projekt (``scope=project``) oder die eigenen, zugewiesenen
    Arbeitselemente im ganzen Workspace (``scope=my_work_items``).
    Widerruf über ``revoked_at`` (kein Soft-Delete, damit keine Celery-Kaskade
    angestoßen wird); „Neu erzeugen“ ersetzt den Hash in derselben Zeile.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="ext_calendar_feeds",
    )
    workspace = models.ForeignKey(
        "db.Workspace",
        on_delete=models.CASCADE,
        related_name="ext_calendar_feeds",
    )
    project = models.ForeignKey(
        "db.Project",
        on_delete=models.CASCADE,
        related_name="ext_calendar_feeds",
        null=True,
        blank=True,
    )
    scope = models.CharField(max_length=32, choices=CalendarFeedScope.choices)
    token_hash = models.CharField(max_length=64, unique=True)
    # Erste Zeichen des Tokens, nur zur Wiedererkennung in der Liste.
    token_prefix = models.CharField(max_length=TOKEN_PREFIX_LENGTH)
    hide_completed = models.BooleanField(default=False)
    last_used_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "ext_calendar_feeds"
        verbose_name = "Calendar feed"
        verbose_name_plural = "Calendar feeds"
        ordering = ("-created_at",)
        constraints = [
            models.CheckConstraint(
                condition=(Q(scope="project", project__isnull=False) | Q(scope="my_work_items", project__isnull=True)),
                name="ext_calendar_feed_scope_project_consistent",
            )
        ]
        indexes = [models.Index(fields=["user", "workspace"], name="ext_cal_feed_user_ws_idx")]

    def set_new_token(self) -> str:
        """Neues Token setzen und den Klartext (nur dieses eine Mal) zurückgeben."""
        token = generate_token()
        self.token_hash = hash_token(token)
        self.token_prefix = token[:TOKEN_PREFIX_LENGTH]
        return token

    @property
    def is_active(self) -> bool:
        return self.revoked_at is None and self.deleted_at is None
