# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import serializers

# Module imports
from plane.app.serializers.base import BaseSerializer
from plane.db.models import Cycle, Label, Module, ProjectMember, State
from plane.utils.content_validator import validate_html_content

from . import schedule
from .models import RecurringWorkItem, RecurringWorkItemRun

# Fields whose change requires recomputing the next occurrence
SCHEDULE_INPUT_FIELDS = {
    "frequency",
    "interval",
    "weekdays",
    "month_day",
    "start_date",
    "end_type",
    "end_date",
    "max_occurrences",
    "create_days_before",
    "is_active",
}


class RecurringWorkItemRunSerializer(BaseSerializer):
    issue_name = serializers.CharField(source="issue.name", read_only=True, default=None)
    issue_sequence_id = serializers.IntegerField(source="issue.sequence_id", read_only=True, default=None)

    class Meta:
        model = RecurringWorkItemRun
        fields = [
            "id",
            "recurring_work_item",
            "issue",
            "issue_name",
            "issue_sequence_id",
            "occurrence_date",
            "trigger",
            "status",
            "error",
            "warnings",
            "created_at",
        ]
        read_only_fields = fields


class RecurringWorkItemSerializer(BaseSerializer):
    state_id = serializers.PrimaryKeyRelatedField(
        source="state", queryset=State.objects.all(), required=False, allow_null=True
    )
    cycle_id = serializers.PrimaryKeyRelatedField(
        source="cycle", queryset=Cycle.objects.all(), required=False, allow_null=True
    )
    module_id = serializers.PrimaryKeyRelatedField(
        source="module", queryset=Module.objects.all(), required=False, allow_null=True
    )
    assignee_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    label_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    weekdays = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=6), required=False, allow_empty=True
    )
    project_id = serializers.UUIDField(read_only=True)
    workspace_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = RecurringWorkItem
        fields = [
            "id",
            "project_id",
            "workspace_id",
            "name",
            "description_html",
            "priority",
            "state_id",
            "assignee_ids",
            "label_ids",
            "cycle_id",
            "module_id",
            "duration_days",
            "frequency",
            "interval",
            "weekdays",
            "month_day",
            "create_days_before",
            "start_date",
            "end_type",
            "end_date",
            "max_occurrences",
            "is_active",
            "next_occurrence_date",
            "next_run_at",
            "last_occurrence_date",
            "last_run_at",
            "occurrence_count",
            "created_at",
            "updated_at",
            "created_by",
        ]
        read_only_fields = [
            "id",
            "project_id",
            "workspace_id",
            "next_occurrence_date",
            "next_run_at",
            "last_occurrence_date",
            "last_run_at",
            "occurrence_count",
            "created_at",
            "updated_at",
            "created_by",
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["assignee_ids"] = [str(pk) for pk in instance.assignees.values_list("id", flat=True)]
        data["label_ids"] = [str(pk) for pk in instance.labels.values_list("id", flat=True)]
        return data

    def _value(self, attrs, key):
        if key in attrs:
            return attrs[key]
        return getattr(self.instance, key, None) if self.instance is not None else None

    def validate(self, attrs):
        project_id = self.context["project_id"]

        if "description_html" in attrs:
            html = attrs.get("description_html") or "<p></p>"
            is_valid, _error, sanitized = validate_html_content(html)
            if not is_valid:
                raise serializers.ValidationError({"description_html": "html content is not valid"})
            attrs["description_html"] = sanitized if sanitized is not None else html

        # related objects must belong to the project of the URL
        for key, model_name in (("state", "state_id"), ("cycle", "cycle_id"), ("module", "module_id")):
            obj = attrs.get(key)
            if obj is not None and str(obj.project_id) != str(project_id):
                raise serializers.ValidationError({model_name: "Not part of this project"})
        if attrs.get("cycle") is not None and attrs["cycle"].archived_at is not None:
            raise serializers.ValidationError({"cycle_id": "Cycle is archived"})
        if attrs.get("module") is not None and attrs["module"].archived_at is not None:
            raise serializers.ValidationError({"module_id": "Module is archived"})

        if attrs.get("label_ids"):
            label_ids = {str(pk) for pk in attrs["label_ids"]}
            found = {
                str(pk)
                for pk in Label.objects.filter(project_id=project_id, id__in=label_ids).values_list("id", flat=True)
            }
            if found != label_ids:
                raise serializers.ValidationError({"label_ids": "Labels must belong to this project"})
            attrs["label_ids"] = sorted(found)

        if attrs.get("assignee_ids"):
            assignee_ids = {str(pk) for pk in attrs["assignee_ids"]}
            found = {
                str(pk)
                for pk in ProjectMember.objects.filter(
                    project_id=project_id, member_id__in=assignee_ids, role__gte=15, is_active=True
                ).values_list("member_id", flat=True)
            }
            if found != assignee_ids:
                raise serializers.ValidationError({"assignee_ids": "Assignees must be members of this project"})
            attrs["assignee_ids"] = sorted(found)

        # rule
        frequency = self._value(attrs, "frequency") or schedule.FREQUENCY_WEEKLY
        if frequency == schedule.FREQUENCY_WEEKLY:
            weekdays = self._value(attrs, "weekdays") or []
            if not weekdays:
                raise serializers.ValidationError({"weekdays": "Select at least one weekday"})
            if "weekdays" in attrs:
                attrs["weekdays"] = sorted(set(attrs["weekdays"]))
        if frequency == schedule.FREQUENCY_MONTHLY and not self._value(attrs, "month_day"):
            raise serializers.ValidationError({"month_day": "Day of month is required"})

        start_date = self._value(attrs, "start_date")
        if start_date is None:
            raise serializers.ValidationError({"start_date": "This field is required"})
        end_type = self._value(attrs, "end_type") or schedule.END_NEVER
        if end_type == schedule.END_ON_DATE:
            end_date = self._value(attrs, "end_date")
            if end_date is None:
                raise serializers.ValidationError({"end_date": "End date is required"})
            if end_date < start_date:
                raise serializers.ValidationError({"end_date": "End date must not be before the start date"})
        if end_type == schedule.END_AFTER_COUNT and not self._value(attrs, "max_occurrences"):
            raise serializers.ValidationError({"max_occurrences": "Number of occurrences is required"})
        return attrs

    def _set_relations(self, instance, assignee_ids, label_ids):
        if assignee_ids is not None:
            instance.assignees.set(assignee_ids)
        if label_ids is not None:
            instance.labels.set(label_ids)

    def create(self, validated_data):
        from .services import reschedule

        assignee_ids = validated_data.pop("assignee_ids", None)
        label_ids = validated_data.pop("label_ids", None)
        instance = RecurringWorkItem(**validated_data, project_id=self.context["project_id"])
        reschedule(instance)
        instance.save()
        self._set_relations(instance, assignee_ids, label_ids)
        return instance

    def update(self, instance, validated_data):
        from .services import reschedule

        assignee_ids = validated_data.pop("assignee_ids", None)
        label_ids = validated_data.pop("label_ids", None)
        needs_reschedule = bool(SCHEDULE_INPUT_FIELDS & set(validated_data.keys()))
        for key, value in validated_data.items():
            setattr(instance, key, value)
        if needs_reschedule:
            reschedule(instance)
        instance.save()
        self._set_relations(instance, assignee_ids, label_ids)
        return instance
