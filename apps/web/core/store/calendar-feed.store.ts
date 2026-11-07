/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { orderBy } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// plane imports
import type { TCalendarFeed, TCalendarFeedCreatePayload, TCalendarFeedWithUrl } from "@plane/types";
// services
import { CalendarFeedService } from "@/services/calendar-feed.service";

/**
 * Kalender-Abos des angemeldeten Nutzers.
 * Die Klartext-URL wird nie im Store gehalten, nur an den Aufrufer zurückgegeben.
 */
export interface ICalendarFeedStore {
  // observables
  feedMap: Record<string, TCalendarFeed>;
  isLoading: boolean;
  // computed
  allFeeds: TCalendarFeed[];
  // helpers
  getProjectFeeds: (projectId: string) => TCalendarFeed[];
  // actions
  fetchMyFeeds: () => Promise<TCalendarFeed[]>;
  fetchProjectFeeds: (workspaceSlug: string, projectId: string) => Promise<TCalendarFeed[]>;
  createFeed: (workspaceSlug: string, data: TCalendarFeedCreatePayload) => Promise<TCalendarFeedWithUrl>;
  revokeFeed: (workspaceSlug: string, feedId: string) => Promise<void>;
  regenerateFeed: (workspaceSlug: string, feedId: string) => Promise<TCalendarFeedWithUrl>;
}

const withoutUrl = (feed: TCalendarFeedWithUrl): TCalendarFeed => {
  const { url: _url, ...rest } = feed;
  return rest;
};

export class CalendarFeedStore implements ICalendarFeedStore {
  feedMap: Record<string, TCalendarFeed> = {};
  isLoading = false;
  // services
  service: CalendarFeedService;

  constructor() {
    makeObservable(this, {
      feedMap: observable,
      isLoading: observable.ref,
      allFeeds: computed,
      fetchMyFeeds: action,
      fetchProjectFeeds: action,
      createFeed: action,
      revokeFeed: action,
      regenerateFeed: action,
    });
    this.service = new CalendarFeedService();
  }

  get allFeeds() {
    return orderBy(Object.values(this.feedMap), ["created_at"], ["desc"]);
  }

  getProjectFeeds = computedFn((projectId: string) =>
    this.allFeeds.filter((feed) => feed.scope === "project" && feed.project === projectId)
  );

  private upsert = (feeds: TCalendarFeed[]) => {
    runInAction(() => {
      for (const feed of feeds) this.feedMap[feed.id] = feed;
    });
  };

  fetchMyFeeds = async () => {
    this.isLoading = true;
    try {
      const feeds = await this.service.listMine();
      runInAction(() => {
        // Vollständige Liste: veraltete Einträge (z. B. anderswo widerrufen) entfernen.
        this.feedMap = Object.fromEntries(feeds.map((feed) => [feed.id, feed]));
      });
      return feeds;
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  };

  fetchProjectFeeds = async (workspaceSlug: string, projectId: string) => {
    this.isLoading = true;
    try {
      const feeds = await this.service.list(workspaceSlug, { project_id: projectId });
      runInAction(() => {
        for (const feed of this.getProjectFeeds(projectId)) delete this.feedMap[feed.id];
      });
      this.upsert(feeds);
      return feeds;
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  };

  createFeed = async (workspaceSlug: string, data: TCalendarFeedCreatePayload) => {
    const response = await this.service.create(workspaceSlug, data);
    this.upsert([withoutUrl(response)]);
    return response;
  };

  revokeFeed = async (workspaceSlug: string, feedId: string) => {
    await this.service.revoke(workspaceSlug, feedId);
    runInAction(() => {
      delete this.feedMap[feedId];
    });
  };

  regenerateFeed = async (workspaceSlug: string, feedId: string) => {
    const response = await this.service.regenerate(workspaceSlug, feedId);
    this.upsert([withoutUrl(response)]);
    return response;
  };
}
