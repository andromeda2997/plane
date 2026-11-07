/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { API_BASE_URL } from "@plane/constants";
import type { TCalendarFeed, TCalendarFeedCreatePayload, TCalendarFeedWithUrl } from "@plane/types";
// services
import { APIService } from "@/services/api.service";

/** Kalender-Abos (ICS-Feeds), Backend: plane.ext.calendar_feed */
export class CalendarFeedService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  /** Alle aktiven Feeds des angemeldeten Nutzers (workspace-übergreifend). */
  async listMine(): Promise<TCalendarFeed[]> {
    return this.get(`/api/users/me/calendar-feeds/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async list(workspaceSlug: string, params?: { project_id?: string }): Promise<TCalendarFeed[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/calendar-feeds/`, { params })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async create(workspaceSlug: string, data: TCalendarFeedCreatePayload): Promise<TCalendarFeedWithUrl> {
    return this.post(`/api/workspaces/${workspaceSlug}/calendar-feeds/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async revoke(workspaceSlug: string, feedId: string): Promise<void> {
    return this.delete(`/api/workspaces/${workspaceSlug}/calendar-feeds/${feedId}/`)
      .then(() => undefined)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async regenerate(workspaceSlug: string, feedId: string): Promise<TCalendarFeedWithUrl> {
    return this.post(`/api/workspaces/${workspaceSlug}/calendar-feeds/${feedId}/regenerate/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
