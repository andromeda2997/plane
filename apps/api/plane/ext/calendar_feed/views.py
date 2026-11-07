# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import timedelta

from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.negotiation import BaseContentNegotiation
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import Project, ProjectMember, Workspace

from .feed import FeedNotAvailable, get_web_url, render_feed
from .models import CalendarFeed, CalendarFeedScope, hash_token
from .serializers import CalendarFeedCreateSerializer, CalendarFeedSerializer
from .throttles import CalendarFeedIPThrottle, CalendarFeedTokenThrottle

# Höchstzahl aktiver Feeds pro Nutzer und Workspace.
MAX_ACTIVE_FEEDS_PER_WORKSPACE = 20
# „Zuletzt abgerufen“ nicht bei jedem Abruf schreiben.
LAST_USED_UPDATE_INTERVAL = timedelta(minutes=5)
PUBLIC_PATH_PREFIX = "/api/calendar-feeds/"
REDACTED_PATH = PUBLIC_PATH_PREFIX + "[redacted].ics"

ALL_ROLES = [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST]


def build_feed_url(request, token: str) -> str:
    base = get_web_url() or request.build_absolute_uri("/").rstrip("/")
    return f"{base}{PUBLIC_PATH_PREFIX}{token}.ics"


def _active_feeds(user):
    return (
        CalendarFeed.objects.filter(user=user, revoked_at__isnull=True)
        .filter(
            workspace__workspace_member__member=user,
            workspace__workspace_member__is_active=True,
            workspace__workspace_member__deleted_at__isnull=True,
        )
        .select_related("workspace", "project")
        .distinct()
    )


class UserCalendarFeedsEndpoint(BaseAPIView):
    """Alle aktiven Feeds des angemeldeten Nutzers (workspace-übergreifend)."""

    def get(self, request):
        feeds = _active_feeds(request.user)
        return Response(CalendarFeedSerializer(feeds, many=True).data, status=status.HTTP_200_OK)


class WorkspaceCalendarFeedsEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=ALL_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        feeds = _active_feeds(request.user).filter(workspace__slug=slug)
        project_id = request.query_params.get("project_id")
        if project_id:
            feeds = feeds.filter(project_id=project_id)
        scope = request.query_params.get("scope")
        if scope:
            feeds = feeds.filter(scope=scope)
        return Response(CalendarFeedSerializer(feeds, many=True).data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=ALL_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        serializer = CalendarFeedCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        workspace = Workspace.objects.get(slug=slug)
        project = None
        if data["scope"] == CalendarFeedScope.PROJECT:
            project = Project.objects.filter(
                id=data["project_id"], workspace=workspace, archived_at__isnull=True
            ).first()
            is_member = (
                project is not None
                and ProjectMember.objects.filter(project=project, member=request.user, is_active=True).exists()
            )
            if not is_member:
                return Response({"error": "Project not found."}, status=status.HTTP_404_NOT_FOUND)

        active_count = CalendarFeed.objects.filter(
            user=request.user, workspace=workspace, revoked_at__isnull=True
        ).count()
        if active_count >= MAX_ACTIVE_FEEDS_PER_WORKSPACE:
            return Response(
                {"error": "Too many calendar feeds. Revoke an existing one first."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        feed = CalendarFeed(
            user=request.user,
            workspace=workspace,
            project=project,
            scope=data["scope"],
            hide_completed=data["hide_completed"],
        )
        token = feed.set_new_token()
        feed.save()

        response = CalendarFeedSerializer(feed).data
        # Klartext-URL nur in dieser Antwort.
        response["url"] = build_feed_url(request, token)
        return Response(response, status=status.HTTP_201_CREATED)


class WorkspaceCalendarFeedDetailEndpoint(BaseAPIView):
    def _get_feed(self, request, slug, pk):
        return (
            CalendarFeed.objects.filter(pk=pk, user=request.user, workspace__slug=slug, revoked_at__isnull=True)
            .select_related("workspace", "project")
            .first()
        )

    @allow_permission(allowed_roles=ALL_ROLES, level="WORKSPACE")
    def delete(self, request, slug, pk):
        """Widerrufen: der Feed liefert ab sofort 404."""
        feed = self._get_feed(request, slug, pk)
        if feed is None:
            return Response({"error": "Calendar feed not found."}, status=status.HTTP_404_NOT_FOUND)
        CalendarFeed.objects.filter(pk=feed.pk).update(revoked_at=timezone.now(), updated_by=request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkspaceCalendarFeedRegenerateEndpoint(WorkspaceCalendarFeedDetailEndpoint):
    @allow_permission(allowed_roles=ALL_ROLES, level="WORKSPACE")
    def post(self, request, slug, pk):
        """Neues Token für denselben Feed; die alte URL ist sofort ungültig."""
        feed = self._get_feed(request, slug, pk)
        if feed is None:
            return Response({"error": "Calendar feed not found."}, status=status.HTTP_404_NOT_FOUND)
        token = feed.set_new_token()
        feed.last_used_at = None
        feed.save(update_fields=["token_hash", "token_prefix", "last_used_at", "updated_at", "updated_by"])
        response = CalendarFeedSerializer(feed).data
        response["url"] = build_feed_url(request, token)
        return Response(response, status=status.HTTP_200_OK)


def _not_found():
    return HttpResponse("Not found\n", status=404, content_type="text/plain; charset=utf-8")


def _apply_private_headers(response):
    # Kein Caching in Proxies/CDNs: der Inhalt gehört genau einem Token.
    response["Cache-Control"] = "private, no-store, max-age=0"
    response["Pragma"] = "no-cache"
    response["X-Robots-Tag"] = "noindex, nofollow"
    response["Referrer-Policy"] = "no-referrer"
    return response


def _parse_bool(value):
    if value is None:
        return None
    value = value.strip().lower()
    if value in ("1", "true", "yes", "on"):
        return True
    if value in ("0", "false", "no", "off"):
        return False
    return None


class IgnoreClientContentNegotiation(BaseContentNegotiation):
    """Accept-Header ignorieren.

    Plane rendert global nur JSON; Kalender-Clients schicken teils
    ``Accept: text/calendar`` – DRF würde dann mit 406 antworten, bevor die View
    überhaupt läuft. Die View liefert ohnehin eine fertige HttpResponse.
    """

    def select_parser(self, request, parsers):
        return parsers[0] if parsers else None

    def select_renderer(self, request, renderers, format_suffix=None):
        return (renderers[0], renderers[0].media_type)


class PublicCalendarFeedEndpoint(APIView):
    """``GET /api/calendar-feeds/<token>.ics`` – ohne Login, nur über das Token."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [CalendarFeedIPThrottle, CalendarFeedTokenThrottle]
    content_negotiation_class = IgnoreClientContentNegotiation

    def dispatch(self, request, *args, **kwargs):
        # Das Klartext-Token soll nicht im Request-Log von Plane landen
        # (RequestLoggerMiddleware loggt request.get_full_path() nach der Antwort).
        if request.path.startswith(PUBLIC_PATH_PREFIX):
            request.path = REDACTED_PATH
            request.path_info = REDACTED_PATH
        return super().dispatch(request, *args, **kwargs)

    def get(self, request, token):
        feed = (
            CalendarFeed.objects.filter(token_hash=hash_token(token), revoked_at__isnull=True)
            .select_related("user", "user__profile", "workspace", "project")
            .first()
        )
        if feed is None:
            return _apply_private_headers(_not_found())

        try:
            body = render_feed(feed, hide_completed=_parse_bool(request.query_params.get("hide_completed")))
        except FeedNotAvailable:
            return _apply_private_headers(_not_found())

        now = timezone.now()
        if feed.last_used_at is None or now - feed.last_used_at > LAST_USED_UPDATE_INTERVAL:
            # update() statt save(): keine Audit-Felder/Signale für anonyme Abrufe.
            CalendarFeed.objects.filter(pk=feed.pk).update(last_used_at=now)

        response = HttpResponse(body.encode("utf-8"), content_type="text/calendar; charset=utf-8")
        response["Content-Disposition"] = 'inline; filename="plane.ics"'
        return _apply_private_headers(response)
