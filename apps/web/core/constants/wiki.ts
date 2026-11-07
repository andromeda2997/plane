/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Platzhalter-"Projekt" für die Verbindung zum Live-/Collaboration-Server.
 *
 * Der unveränderte Live-Server (apps/live) kennt nur den Dokumenttyp "project_page" und ruft
 * /api/workspaces/<slug>/projects/<projectId>/pages/<id>/(description/) auf. Das Backend
 * (plane.ext.wiki, LIVE_COMPAT_PROJECT_SEGMENT) bildet genau diese Pfade für Wiki-Seiten ab.
 * Muss mit apps/api/plane/ext/wiki/constants.py übereinstimmen.
 */
export const WIKI_LIVE_PROJECT_ID = "wiki";
