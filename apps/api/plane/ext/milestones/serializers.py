# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import re

from rest_framework import serializers

from plane.app.serializers.base import BaseSerializer

from .models import MILESTONE_DESCRIPTION_MAX_LENGTH, Milestone

HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
MAX_IDS_PER_REQUEST = 500


class MilestoneSerializer(BaseSerializer):
    """Meilenstein inkl. Fortschritt (Annotationen aus ``selectors.annotate_progress``)."""

    total_issues = serializers.IntegerField(read_only=True)
    completed_issues = serializers.IntegerField(read_only=True)
    cancelled_issues = serializers.IntegerField(read_only=True)
    description = serializers.CharField(
        required=False, allow_blank=True, max_length=MILESTONE_DESCRIPTION_MAX_LENGTH, trim_whitespace=True
    )

    class Meta:
        model = Milestone
        fields = [
            "id",
            "name",
            "description",
            "date",
            "color",
            "sort_order",
            "project",
            "workspace",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
            "total_issues",
            "completed_issues",
            "cancelled_issues",
        ]
        read_only_fields = ["project", "workspace", "created_by", "updated_by", "created_at", "updated_at"]

    def validate_name(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("Name must not be empty.")
        return value

    def validate_color(self, value):
        if not HEX_COLOR_RE.match(value or ""):
            raise serializers.ValidationError("Color must be a hex value like #3F76FF.")
        return value.upper()


class IssueIdsSerializer(serializers.Serializer):
    issue_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=False, max_length=MAX_IDS_PER_REQUEST)


class MilestoneIdsSerializer(serializers.Serializer):
    milestone_ids = serializers.ListField(
        child=serializers.UUIDField(), allow_empty=True, max_length=MAX_IDS_PER_REQUEST
    )
