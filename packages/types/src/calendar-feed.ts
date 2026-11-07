/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export type TCalendarFeedScope = "project" | "my_work_items";

/** Kalender-Abo (ICS-Feed) ohne Token – so liefert es die Liste. */
export type TCalendarFeed = {
  id: string;
  scope: TCalendarFeedScope;
  workspace: string;
  workspace_slug: string;
  workspace_name: string;
  project: string | null;
  project_name: string | null;
  project_identifier: string | null;
  hide_completed: boolean;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
};

/** Antwort beim Anlegen/Neu-Erzeugen: enthält die URL genau einmal. */
export type TCalendarFeedWithUrl = TCalendarFeed & {
  url: string;
};

export type TCalendarFeedCreatePayload = {
  scope: TCalendarFeedScope;
  project_id?: string | null;
  hide_completed?: boolean;
};
