# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseViewSet

from .models import RecurringWorkItem, RecurringWorkItemRun
from .serializers import RecurringWorkItemRunSerializer, RecurringWorkItemSerializer
from .services import reschedule, run_now


class RecurringWorkItemViewSet(BaseViewSet):
    serializer_class = RecurringWorkItemSerializer
    model = RecurringWorkItem

    def get_queryset(self):
        return (
            RecurringWorkItem.objects.filter(
                workspace__slug=self.kwargs.get("slug"),
                project_id=self.kwargs.get("project_id"),
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
                project__archived_at__isnull=True,
            )
            .select_related("project", "project__workspace")
            .prefetch_related("assignees", "labels")
            .distinct()
            .order_by("-created_at")
        )

    def _get_rule(self, pk):
        return self.get_queryset().filter(pk=pk).first()

    def _serialize(self, rule, project_id):
        return RecurringWorkItemSerializer(rule, context={"project_id": project_id}).data

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def list(self, request, slug, project_id):
        rules = self.get_queryset()
        return Response(
            RecurringWorkItemSerializer(rules, many=True, context={"project_id": project_id}).data,
            status=status.HTTP_200_OK,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def retrieve(self, request, slug, project_id, pk):
        rule = self._get_rule(pk)
        if rule is None:
            return Response({"error": "Recurring work item not found"}, status=status.HTTP_404_NOT_FOUND)
        return Response(self._serialize(rule, project_id), status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def create(self, request, slug, project_id):
        serializer = RecurringWorkItemSerializer(data=request.data, context={"project_id": project_id})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        rule = serializer.save()
        return Response(self._serialize(rule, project_id), status=status.HTTP_201_CREATED)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def partial_update(self, request, slug, project_id, pk):
        rule = self._get_rule(pk)
        if rule is None:
            return Response({"error": "Recurring work item not found"}, status=status.HTTP_404_NOT_FOUND)
        serializer = RecurringWorkItemSerializer(
            rule, data=request.data, partial=True, context={"project_id": project_id}
        )
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        rule = serializer.save()
        return Response(self._serialize(rule, project_id), status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def destroy(self, request, slug, project_id, pk):
        rule = self._get_rule(pk)
        if rule is None:
            return Response({"error": "Recurring work item not found"}, status=status.HTTP_404_NOT_FOUND)
        rule.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def _set_active(self, request, project_id, pk, is_active):
        rule = self._get_rule(pk)
        if rule is None:
            return Response({"error": "Recurring work item not found"}, status=status.HTTP_404_NOT_FOUND)
        rule.is_active = is_active
        reschedule(rule)
        rule.save()
        return Response(self._serialize(rule, project_id), status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def pause(self, request, slug, project_id, pk):
        return self._set_active(request, project_id, pk, False)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def resume(self, request, slug, project_id, pk):
        return self._set_active(request, project_id, pk, True)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def run(self, request, slug, project_id, pk):
        rule = self._get_rule(pk)
        if rule is None:
            return Response({"error": "Recurring work item not found"}, status=status.HTTP_404_NOT_FOUND)
        run = run_now(rule, request.user)
        rule.refresh_from_db()
        response_status = (
            status.HTTP_201_CREATED
            if run.status == RecurringWorkItemRun.STATUS_SUCCESS
            else status.HTTP_400_BAD_REQUEST
        )
        return Response(
            {
                "run": RecurringWorkItemRunSerializer(run).data,
                "recurring_work_item": self._serialize(rule, project_id),
            },
            status=response_status,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def runs(self, request, slug, project_id, pk):
        rule = self._get_rule(pk)
        if rule is None:
            return Response({"error": "Recurring work item not found"}, status=status.HTTP_404_NOT_FOUND)
        try:
            limit = min(max(int(request.GET.get("limit", 50)), 1), 200)
        except ValueError:
            limit = 50
        runs = RecurringWorkItemRun.objects.filter(recurring_work_item=rule).select_related("issue")[:limit]
        return Response(RecurringWorkItemRunSerializer(runs, many=True).data, status=status.HTTP_200_OK)
