# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import serializers

# Module imports
from plane.app.serializers.base import BaseSerializer
from plane.db.models import Page


class WikiPageSerializer(BaseSerializer):
    """Wiki-Seite im gleichen Format wie die Projekt-Seiten (TPage im Frontend).

    Nur Metadaten sind hier schreibbar; parent und access werden in den Views
    geprüft (Zyklen, Besitzer), Sperren/Archivieren laufen über eigene Endpunkte.
    """

    is_favorite = serializers.SerializerMethodField()
    label_ids = serializers.SerializerMethodField()
    project_ids = serializers.SerializerMethodField()

    class Meta:
        model = Page
        fields = [
            "id",
            "name",
            "owned_by",
            "access",
            "color",
            "parent",
            "is_favorite",
            "is_locked",
            "is_global",
            "archived_at",
            "workspace",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
            "view_props",
            "logo_props",
            "label_ids",
            "project_ids",
            "sort_order",
        ]
        read_only_fields = [
            "sort_order",
            "id",
            "owned_by",
            "access",
            "parent",
            "is_locked",
            "is_global",
            "archived_at",
            "workspace",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        ]

    def get_is_favorite(self, obj):
        # Favoriten sind im CE-Frontend an Projekte gebunden -> im Wiki nicht unterstützt
        return False

    def get_label_ids(self, obj):
        return []

    def get_project_ids(self, obj):
        return []


class WikiPageDetailSerializer(WikiPageSerializer):
    description_html = serializers.CharField(read_only=True)

    class Meta(WikiPageSerializer.Meta):
        fields = WikiPageSerializer.Meta.fields + ["description_html"]
