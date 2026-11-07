# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import transaction
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import Issue, Project

from .models import Milestone, MilestoneIssue
from .selectors import annotated_milestones
from .serializers import IssueIdsSerializer, MilestoneIdsSerializer, MilestoneSerializer

READ_ROLES = [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST]
WRITE_ROLES = [ROLE.ADMIN, ROLE.MEMBER]


def _serialized(slug, project_id, pk):
    return MilestoneSerializer(annotated_milestones(slug, project_id).get(pk=pk)).data


def _bad_request(message):
    return Response({"error": message}, status=status.HTTP_400_BAD_REQUEST)


class MilestoneListEndpoint(BaseAPIView):
    @allow_permission(READ_ROLES)
    def get(self, request, slug, project_id):
        milestones = annotated_milestones(slug, project_id)
        return Response(MilestoneSerializer(milestones, many=True).data, status=status.HTTP_200_OK)

    @allow_permission(WRITE_ROLES)
    def post(self, request, slug, project_id):
        project = Project.objects.get(pk=project_id, workspace__slug=slug)
        serializer = MilestoneSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        milestone = serializer.save(project=project)
        return Response(_serialized(slug, project_id, milestone.pk), status=status.HTTP_201_CREATED)


class MilestoneDetailEndpoint(BaseAPIView):
    @allow_permission(READ_ROLES)
    def get(self, request, slug, project_id, pk):
        return Response(_serialized(slug, project_id, pk), status=status.HTTP_200_OK)

    @allow_permission(WRITE_ROLES)
    def patch(self, request, slug, project_id, pk):
        milestone = Milestone.objects.get(pk=pk, project_id=project_id, workspace__slug=slug)
        serializer = MilestoneSerializer(milestone, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(_serialized(slug, project_id, pk), status=status.HTTP_200_OK)

    @allow_permission(WRITE_ROLES)
    def delete(self, request, slug, project_id, pk):
        milestone = Milestone.objects.get(pk=pk, project_id=project_id, workspace__slug=slug)
        # Soft-Delete per QuerySet (setzt nur deleted_at): Verknüpfungen sofort
        # mitlöschen, statt auf die Celery-Kaskade von Model.delete() zu warten.
        with transaction.atomic():
            MilestoneIssue.objects.filter(milestone=milestone).delete()
            Milestone.objects.filter(pk=milestone.pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MilestoneIssuesEndpoint(BaseAPIView):
    """Arbeitselemente mit einem Meilenstein verknüpfen (idempotent)."""

    @allow_permission(READ_ROLES)
    def get(self, request, slug, project_id, pk):
        milestone = Milestone.objects.get(pk=pk, project_id=project_id, workspace__slug=slug)
        issue_ids = MilestoneIssue.objects.filter(milestone=milestone, issue__deleted_at__isnull=True).values_list(
            "issue_id", flat=True
        )
        return Response({"issue_ids": [str(i) for i in issue_ids]}, status=status.HTTP_200_OK)

    @allow_permission(WRITE_ROLES)
    def post(self, request, slug, project_id, pk):
        milestone = Milestone.objects.get(pk=pk, project_id=project_id, workspace__slug=slug)
        serializer = IssueIdsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        requested = set(serializer.validated_data["issue_ids"])

        # Nur Arbeitselemente aus demselben Projekt.
        valid = set(
            Issue.objects.filter(pk__in=requested, project_id=project_id, workspace__slug=slug).values_list(
                "pk", flat=True
            )
        )
        if valid != requested:
            return _bad_request("Work items must belong to the milestone's project.")

        existing = set(
            MilestoneIssue.objects.filter(milestone=milestone, issue_id__in=valid).values_list("issue_id", flat=True)
        )
        MilestoneIssue.objects.bulk_create(
            [
                MilestoneIssue(
                    milestone=milestone,
                    issue_id=issue_id,
                    project_id=milestone.project_id,
                    workspace_id=milestone.workspace_id,
                    created_by=request.user,
                )
                for issue_id in valid - existing
            ],
            ignore_conflicts=True,
        )
        return Response(_serialized(slug, project_id, pk), status=status.HTTP_200_OK)


class MilestoneIssueDetailEndpoint(BaseAPIView):
    @allow_permission(WRITE_ROLES)
    def delete(self, request, slug, project_id, pk, issue_id):
        milestone = Milestone.objects.get(pk=pk, project_id=project_id, workspace__slug=slug)
        MilestoneIssue.objects.filter(milestone=milestone, issue_id=issue_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class IssueMilestonesEndpoint(BaseAPIView):
    """Zu welchen Meilensteinen gehört ein Arbeitselement? (lesen / komplett setzen)"""

    def _issue(self, slug, project_id, issue_id):
        return Issue.objects.get(pk=issue_id, project_id=project_id, workspace__slug=slug)

    @staticmethod
    def _milestone_ids(issue):
        return [
            str(milestone_id)
            for milestone_id in MilestoneIssue.objects.filter(issue=issue, milestone__deleted_at__isnull=True)
            .order_by("milestone__date", "milestone__sort_order")
            .values_list("milestone_id", flat=True)
        ]

    @allow_permission(READ_ROLES)
    def get(self, request, slug, project_id, issue_id):
        issue = self._issue(slug, project_id, issue_id)
        return Response({"milestone_ids": self._milestone_ids(issue)}, status=status.HTTP_200_OK)

    @allow_permission(WRITE_ROLES)
    def put(self, request, slug, project_id, issue_id):
        issue = self._issue(slug, project_id, issue_id)
        serializer = MilestoneIdsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        requested = set(serializer.validated_data["milestone_ids"])

        valid = set(
            Milestone.objects.filter(pk__in=requested, project_id=project_id, workspace__slug=slug).values_list(
                "pk", flat=True
            )
        )
        if valid != requested:
            return _bad_request("Milestones must belong to the work item's project.")

        with transaction.atomic():
            links = MilestoneIssue.objects.filter(issue=issue)
            existing = set(links.values_list("milestone_id", flat=True))
            links.filter(milestone_id__in=existing - valid).delete()
            MilestoneIssue.objects.bulk_create(
                [
                    MilestoneIssue(
                        milestone_id=milestone_id,
                        issue=issue,
                        project_id=issue.project_id,
                        workspace_id=issue.workspace_id,
                        created_by=request.user,
                    )
                    for milestone_id in valid - existing
                ],
                ignore_conflicts=True,
            )
        return Response({"milestone_ids": self._milestone_ids(issue)}, status=status.HTTP_200_OK)
