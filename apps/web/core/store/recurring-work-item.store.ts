/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { set, sortBy, unset } from "lodash-es";
import { action, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// plane imports
import type {
  TRecurringWorkItem,
  TRecurringWorkItemFormData,
  TRecurringWorkItemRun,
  TRecurringWorkItemRunResponse,
} from "@plane/types";
// services
import { RecurringWorkItemService } from "@/services/recurring-work-item.service";

export interface IRecurringWorkItemStore {
  // observables
  recurringWorkItemMap: Record<string, TRecurringWorkItem>;
  fetchedMap: Record<string, boolean>;
  runsMap: Record<string, TRecurringWorkItemRun[]>;
  // computed actions
  getProjectRecurringWorkItems: (projectId: string | undefined | null) => TRecurringWorkItem[] | undefined;
  getRecurringWorkItemById: (id: string) => TRecurringWorkItem | undefined;
  // actions
  fetchRecurringWorkItems: (workspaceSlug: string, projectId: string) => Promise<TRecurringWorkItem[]>;
  createRecurringWorkItem: (
    workspaceSlug: string,
    projectId: string,
    data: Partial<TRecurringWorkItemFormData>
  ) => Promise<TRecurringWorkItem>;
  updateRecurringWorkItem: (
    workspaceSlug: string,
    projectId: string,
    id: string,
    data: Partial<TRecurringWorkItemFormData>
  ) => Promise<TRecurringWorkItem>;
  deleteRecurringWorkItem: (workspaceSlug: string, projectId: string, id: string) => Promise<void>;
  pauseRecurringWorkItem: (workspaceSlug: string, projectId: string, id: string) => Promise<TRecurringWorkItem>;
  resumeRecurringWorkItem: (workspaceSlug: string, projectId: string, id: string) => Promise<TRecurringWorkItem>;
  runRecurringWorkItemNow: (
    workspaceSlug: string,
    projectId: string,
    id: string
  ) => Promise<TRecurringWorkItemRunResponse>;
  fetchRuns: (workspaceSlug: string, projectId: string, id: string) => Promise<TRecurringWorkItemRun[]>;
}

export class RecurringWorkItemStore implements IRecurringWorkItemStore {
  recurringWorkItemMap: Record<string, TRecurringWorkItem> = {};
  fetchedMap: Record<string, boolean> = {};
  runsMap: Record<string, TRecurringWorkItemRun[]> = {};
  // services
  service;

  constructor() {
    makeObservable(this, {
      recurringWorkItemMap: observable,
      fetchedMap: observable,
      runsMap: observable,
      fetchRecurringWorkItems: action,
      createRecurringWorkItem: action,
      updateRecurringWorkItem: action,
      deleteRecurringWorkItem: action,
      pauseRecurringWorkItem: action,
      resumeRecurringWorkItem: action,
      runRecurringWorkItemNow: action,
      fetchRuns: action,
    });
    this.service = new RecurringWorkItemService();
  }

  getProjectRecurringWorkItems = computedFn((projectId: string | undefined | null) => {
    if (!projectId || !this.fetchedMap[projectId]) return undefined;
    return sortBy(
      Object.values(this.recurringWorkItemMap).filter((item) => item.project_id === projectId),
      (item) => item.name.toLowerCase()
    );
  });

  getRecurringWorkItemById = computedFn((id: string) => this.recurringWorkItemMap[id]);

  private upsert = (item: TRecurringWorkItem) => {
    runInAction(() => {
      set(this.recurringWorkItemMap, [item.id], item);
    });
    return item;
  };

  fetchRecurringWorkItems = async (workspaceSlug: string, projectId: string) => {
    const items = await this.service.list(workspaceSlug, projectId);
    runInAction(() => {
      Object.keys(this.recurringWorkItemMap).forEach((id) => {
        if (this.recurringWorkItemMap[id]?.project_id === projectId) unset(this.recurringWorkItemMap, [id]);
      });
      items.forEach((item) => set(this.recurringWorkItemMap, [item.id], item));
      set(this.fetchedMap, [projectId], true);
    });
    return items;
  };

  createRecurringWorkItem = async (
    workspaceSlug: string,
    projectId: string,
    data: Partial<TRecurringWorkItemFormData>
  ) => this.upsert(await this.service.create(workspaceSlug, projectId, data));

  updateRecurringWorkItem = async (
    workspaceSlug: string,
    projectId: string,
    id: string,
    data: Partial<TRecurringWorkItemFormData>
  ) => this.upsert(await this.service.update(workspaceSlug, projectId, id, data));

  deleteRecurringWorkItem = async (workspaceSlug: string, projectId: string, id: string) => {
    await this.service.remove(workspaceSlug, projectId, id);
    runInAction(() => {
      unset(this.recurringWorkItemMap, [id]);
      unset(this.runsMap, [id]);
    });
  };

  pauseRecurringWorkItem = async (workspaceSlug: string, projectId: string, id: string) =>
    this.upsert(await this.service.pause(workspaceSlug, projectId, id));

  resumeRecurringWorkItem = async (workspaceSlug: string, projectId: string, id: string) =>
    this.upsert(await this.service.resume(workspaceSlug, projectId, id));

  runRecurringWorkItemNow = async (workspaceSlug: string, projectId: string, id: string) => {
    try {
      const response = await this.service.runNow(workspaceSlug, projectId, id);
      this.upsert(response.recurring_work_item);
      runInAction(() => {
        if (this.runsMap[id]) this.runsMap[id] = [response.run, ...this.runsMap[id]];
      });
      return response;
    } catch (error) {
      // a failed run is logged by the API, refresh the entry anyway
      const response = error as Partial<TRecurringWorkItemRunResponse> | undefined;
      if (response?.recurring_work_item) this.upsert(response.recurring_work_item);
      throw error;
    }
  };

  fetchRuns = async (workspaceSlug: string, projectId: string, id: string) => {
    const runs = await this.service.listRuns(workspaceSlug, projectId, id);
    runInAction(() => {
      set(this.runsMap, [id], runs);
    });
    return runs;
  };
}
