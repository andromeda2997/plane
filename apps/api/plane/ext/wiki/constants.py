# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Platzhalter-"Projekt" für den Live-/Collaboration-Server (apps/live).
#
# Der unveränderte Live-Server kennt nur den Dokumenttyp "project_page" und baut
# daraus /api/workspaces/<slug>/projects/<projectId>/pages/<id>/(description/).
# Das Wiki-Frontend verbindet sich deshalb mit projectId=<dieser Wert>; die
# Wiki-App registriert für genau diese Pfade einen Kompatibilitäts-Alias.
# Der Wert ist keine UUID und kollidiert daher mit keiner Projekt-Route
# (die alle <uuid:project_id> verwenden). Muss mit
# WIKI_LIVE_PROJECT_ID in apps/web/core/constants/wiki.ts übereinstimmen.
LIVE_COMPAT_PROJECT_SEGMENT = "wiki"
