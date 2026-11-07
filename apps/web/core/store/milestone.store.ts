/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { orderBy } from "lodash-es";
import { action, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// plane imports
import type { TMilestone, TMilestoneFormData } from "@plane/types";
// services
import { MilestoneService } from "@/services/milestone.service";

/**
 * Meilensteine je Projekt und die Meilenstein-Zuordnung je Arbeitselement.
 * Der Fortschritt (Zähler) kommt vom Backend; nach Änderungen an Verknüpfungen
 * wird die Projektliste neu geladen.
 */
export interface IMilestoneStore {
  // observables
  milestoneMap: Record<string, TMilestone>;
  /** projectId → true, sobald die Liste einmal geladen wurde */
  fetchedProjects: Record<string, boolean>;
  /** issueId → milestoneIds */
  issueMilestoneMap: Record<string, string[]>;
  // helpers
  getMilestoneById: (milestoneId: string) => TMilestone | undefined;
  getProjectMilestones: (projectId: string) => TMilestone[];
  getProjectMilestoneIds: (projectId: string) => string[];
  getIssueMilestoneIds: (issueId: string) => string[] | undefined;
  // actions
  fetchProjectMilestones: (workspaceSlug: string, projectId: string) => Promise<TMilestone[]>;
  createMilestone: (workspaceSlug: string, projectId: string, data: Partial<TMilestoneFormData>) => Promise<TMilestone>;
  updateMilestone: (
    workspaceSlug: string,
    projectId: string,
    milestoneId: string,
    data: Partial<TMilestoneFormData>
  ) => Promise<TMilestone>;
  deleteMilestone: (workspaceSlug: string, projectId: string, milestoneId: string) => Promise<void>;
  fetchIssueMilestones: (workspaceSlug: string, projectId: string, issueId: string) => Promise<string[]>;
  setIssueMilestones: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    milestoneIds: string[]
  ) => Promise<string[]>;
}

export class MilestoneStore implements IMilestoneStore {
  milestoneMap: Record<string, TMilestone> = {};
  fetchedProjects: Record<string, boolean> = {};
  issueMilestoneMap: Record<string, string[]> = {};
  // services
  service: MilestoneService;

  constructor() {
    makeObservable(this, {
      milestoneMap: observable,
      fetchedProjects: observable,
      issueMilestoneMap: observable,
      fetchProjectMilestones: action,
      createMilestone: action,
      updateMilestone: action,
      deleteMilestone: action,
      fetchIssueMilestones: action,
      setIssueMilestones: action,
    });
    this.service = new MilestoneService();
  }

  getMilestoneById = computedFn((milestoneId: string) => this.milestoneMap[milestoneId]);

  getProjectMilestones = computedFn((projectId: string) =>
    orderBy(
      Object.values(this.milestoneMap).filter((milestone) => milestone.project === projectId),
      ["date", "sort_order", "created_at"],
      ["asc", "asc", "asc"]
    )
  );

  getProjectMilestoneIds = computedFn((projectId: string) =>
    this.getProjectMilestones(projectId).map((milestone) => milestone.id)
  );

  getIssueMilestoneIds = computedFn((issueId: string) => {
    const ids = this.issueMilestoneMap[issueId];
    // gelöschte Meilensteine ausblenden
    return ids ? ids.filter((id) => !!this.milestoneMap[id]) : undefined;
  });

  private upsert = (milestone: TMilestone) => {
    runInAction(() => {
      this.milestoneMap[milestone.id] = milestone;
    });
  };

  fetchProjectMilestones = async (workspaceSlug: string, projectId: string) => {
    const milestones = await this.service.list(workspaceSlug, projectId);
    runInAction(() => {
      // vollständige Liste: anderswo gelöschte Einträge entfernen
      for (const milestone of Object.values(this.milestoneMap)) {
        if (milestone.project === projectId) delete this.milestoneMap[milestone.id];
      }
      for (const milestone of milestones) this.milestoneMap[milestone.id] = milestone;
      this.fetchedProjects[projectId] = true;
    });
    return milestones;
  };

  createMilestone = async (workspaceSlug: string, projectId: string, data: Partial<TMilestoneFormData>) => {
    const milestone = await this.service.create(workspaceSlug, projectId, data);
    this.upsert(milestone);
    return milestone;
  };

  /** Optimistisch (z. B. beim Ziehen im Gantt), bei Fehler zurückgesetzt. */
  updateMilestone = async (
    workspaceSlug: string,
    projectId: string,
    milestoneId: string,
    data: Partial<TMilestoneFormData>
  ) => {
    const previous = this.milestoneMap[milestoneId];
    if (previous) this.upsert({ ...previous, ...data });
    try {
      const milestone = await this.service.update(workspaceSlug, projectId, milestoneId, data);
      this.upsert(milestone);
      return milestone;
    } catch (error) {
      if (previous) this.upsert(previous);
      throw error;
    }
  };

  deleteMilestone = async (workspaceSlug: string, projectId: string, milestoneId: string) => {
    await this.service.remove(workspaceSlug, projectId, milestoneId);
    runInAction(() => {
      delete this.milestoneMap[milestoneId];
      for (const [issueId, ids] of Object.entries(this.issueMilestoneMap)) {
        if (ids.includes(milestoneId)) this.issueMilestoneMap[issueId] = ids.filter((id) => id !== milestoneId);
      }
    });
  };

  fetchIssueMilestones = async (workspaceSlug: string, projectId: string, issueId: string) => {
    const milestoneIds = await this.service.getIssueMilestones(workspaceSlug, projectId, issueId);
    runInAction(() => {
      this.issueMilestoneMap[issueId] = milestoneIds;
    });
    return milestoneIds;
  };

  setIssueMilestones = async (workspaceSlug: string, projectId: string, issueId: string, milestoneIds: string[]) => {
    const previous = this.issueMilestoneMap[issueId];
    runInAction(() => {
      this.issueMilestoneMap[issueId] = milestoneIds;
    });
    try {
      const saved = await this.service.setIssueMilestones(workspaceSlug, projectId, issueId, milestoneIds);
      runInAction(() => {
        this.issueMilestoneMap[issueId] = saved;
      });
      // Fortschritt der Meilensteine hat sich geändert
      void this.fetchProjectMilestones(workspaceSlug, projectId).catch(() => undefined);
      return saved;
    } catch (error) {
      runInAction(() => {
        if (previous) this.issueMilestoneMap[issueId] = previous;
        else delete this.issueMilestoneMap[issueId];
      });
      throw error;
    }
  };
}
