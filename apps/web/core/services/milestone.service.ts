/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { API_BASE_URL } from "@plane/constants";
import type { TMilestone, TMilestoneFormData } from "@plane/types";
// services
import { APIService } from "@/services/api.service";

/** Meilensteine eines Projekts, Backend: plane.ext.milestones */
export class MilestoneService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private base(workspaceSlug: string, projectId: string) {
    return `/api/workspaces/${workspaceSlug}/projects/${projectId}`;
  }

  async list(workspaceSlug: string, projectId: string): Promise<TMilestone[]> {
    return this.get(`${this.base(workspaceSlug, projectId)}/milestones/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async create(workspaceSlug: string, projectId: string, data: Partial<TMilestoneFormData>): Promise<TMilestone> {
    return this.post(`${this.base(workspaceSlug, projectId)}/milestones/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async update(
    workspaceSlug: string,
    projectId: string,
    milestoneId: string,
    data: Partial<TMilestoneFormData>
  ): Promise<TMilestone> {
    return this.patch(`${this.base(workspaceSlug, projectId)}/milestones/${milestoneId}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async remove(workspaceSlug: string, projectId: string, milestoneId: string): Promise<void> {
    return this.delete(`${this.base(workspaceSlug, projectId)}/milestones/${milestoneId}/`)
      .then(() => undefined)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async addIssues(workspaceSlug: string, projectId: string, milestoneId: string, issueIds: string[]) {
    return this.post(`${this.base(workspaceSlug, projectId)}/milestones/${milestoneId}/issues/`, {
      issue_ids: issueIds,
    })
      .then((response) => response?.data as TMilestone)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async removeIssue(workspaceSlug: string, projectId: string, milestoneId: string, issueId: string) {
    return this.delete(`${this.base(workspaceSlug, projectId)}/milestones/${milestoneId}/issues/${issueId}/`)
      .then(() => undefined)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getIssueMilestones(workspaceSlug: string, projectId: string, issueId: string): Promise<string[]> {
    return this.get(`${this.base(workspaceSlug, projectId)}/issues/${issueId}/milestones/`)
      .then((response) => (response?.data?.milestone_ids ?? []) as string[])
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async setIssueMilestones(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    milestoneIds: string[]
  ): Promise<string[]> {
    return this.put(`${this.base(workspaceSlug, projectId)}/issues/${issueId}/milestones/`, {
      milestone_ids: milestoneIds,
    })
      .then((response) => (response?.data?.milestone_ids ?? []) as string[])
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
