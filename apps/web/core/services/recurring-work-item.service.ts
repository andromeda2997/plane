/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type {
  TRecurringWorkItem,
  TRecurringWorkItemFormData,
  TRecurringWorkItemRun,
  TRecurringWorkItemRunResponse,
} from "@plane/types";
import { APIService } from "@/services/api.service";

export class RecurringWorkItemService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private baseUrl(workspaceSlug: string, projectId: string) {
    return `/api/workspaces/${workspaceSlug}/projects/${projectId}/recurring-work-items/`;
  }

  async list(workspaceSlug: string, projectId: string): Promise<TRecurringWorkItem[]> {
    return this.get(this.baseUrl(workspaceSlug, projectId))
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async create(
    workspaceSlug: string,
    projectId: string,
    data: Partial<TRecurringWorkItemFormData>
  ): Promise<TRecurringWorkItem> {
    return this.post(this.baseUrl(workspaceSlug, projectId), data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async update(
    workspaceSlug: string,
    projectId: string,
    id: string,
    data: Partial<TRecurringWorkItemFormData>
  ): Promise<TRecurringWorkItem> {
    return this.patch(`${this.baseUrl(workspaceSlug, projectId)}${id}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async remove(workspaceSlug: string, projectId: string, id: string): Promise<void> {
    return this.delete(`${this.baseUrl(workspaceSlug, projectId)}${id}/`)
      .then(() => undefined)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async pause(workspaceSlug: string, projectId: string, id: string): Promise<TRecurringWorkItem> {
    return this.post(`${this.baseUrl(workspaceSlug, projectId)}${id}/pause/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async resume(workspaceSlug: string, projectId: string, id: string): Promise<TRecurringWorkItem> {
    return this.post(`${this.baseUrl(workspaceSlug, projectId)}${id}/resume/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async runNow(workspaceSlug: string, projectId: string, id: string): Promise<TRecurringWorkItemRunResponse> {
    return this.post(`${this.baseUrl(workspaceSlug, projectId)}${id}/run/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async listRuns(workspaceSlug: string, projectId: string, id: string): Promise<TRecurringWorkItemRun[]> {
    return this.get(`${this.baseUrl(workspaceSlug, projectId)}${id}/runs/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
