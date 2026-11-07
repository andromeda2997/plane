# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from rest_framework import serializers

from .models import CalendarFeed, CalendarFeedScope


class CalendarFeedSerializer(serializers.ModelSerializer):
    """Ausgabe ohne Token und ohne Hash."""

    workspace_slug = serializers.CharField(source="workspace.slug", read_only=True)
    workspace_name = serializers.CharField(source="workspace.name", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True, default=None)
    project_identifier = serializers.CharField(source="project.identifier", read_only=True, default=None)

    class Meta:
        model = CalendarFeed
        fields = [
            "id",
            "scope",
            "workspace",
            "workspace_slug",
            "workspace_name",
            "project",
            "project_name",
            "project_identifier",
            "hide_completed",
            "token_prefix",
            "created_at",
            "last_used_at",
        ]
        read_only_fields = fields


class CalendarFeedCreateSerializer(serializers.Serializer):
    scope = serializers.ChoiceField(choices=CalendarFeedScope.choices)
    project_id = serializers.UUIDField(required=False, allow_null=True)
    hide_completed = serializers.BooleanField(required=False, default=False)

    def validate(self, attrs):
        if attrs["scope"] == CalendarFeedScope.PROJECT and not attrs.get("project_id"):
            raise serializers.ValidationError({"project_id": "project_id is required for project feeds."})
        if attrs["scope"] == CalendarFeedScope.MY_WORK_ITEMS:
            attrs["project_id"] = None
        return attrs
