/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type { TDocumentPayload, TPage, TPageMovePayload, TPageMoveResponse, TPageVersion } from "@plane/types";
// services
import { APIService } from "@/services/api.service";

/**
 * Workspace-Wiki: Seiten ohne Projekt (Backend: plane.ext.wiki, /api/workspaces/<slug>/pages/).
 */
export class WorkspacePageService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private base(workspaceSlug: string, pageId?: string) {
    return pageId ? `/api/workspaces/${workspaceSlug}/pages/${pageId}/` : `/api/workspaces/${workspaceSlug}/pages/`;
  }

  async fetchAll(workspaceSlug: string): Promise<TPage[]> {
    return this.get(this.base(workspaceSlug))
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async fetchById(workspaceSlug: string, pageId: string): Promise<TPage> {
    return this.get(this.base(workspaceSlug, pageId))
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async create(workspaceSlug: string, data: Partial<TPage>): Promise<TPage> {
    return this.post(this.base(workspaceSlug), data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async update(workspaceSlug: string, pageId: string, data: Partial<TPage>): Promise<TPage> {
    return this.patch(this.base(workspaceSlug, pageId), data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // Seite umhängen und einsortieren (parent + sort_order in einem Aufruf)
  async updatePosition(workspaceSlug: string, pageId: string, data: TPageMovePayload): Promise<TPageMoveResponse> {
    return this.post(`${this.base(workspaceSlug, pageId)}position/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateAccess(workspaceSlug: string, pageId: string, data: Pick<TPage, "access">): Promise<void> {
    return this.post(`${this.base(workspaceSlug, pageId)}access/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async remove(workspaceSlug: string, pageId: string): Promise<void> {
    return this.delete(this.base(workspaceSlug, pageId))
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async archive(workspaceSlug: string, pageId: string): Promise<{ archived_at: string }> {
    return this.post(`${this.base(workspaceSlug, pageId)}archive/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async restore(workspaceSlug: string, pageId: string): Promise<void> {
    return this.delete(`${this.base(workspaceSlug, pageId)}archive/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async lock(workspaceSlug: string, pageId: string): Promise<void> {
    return this.post(`${this.base(workspaceSlug, pageId)}lock/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async unlock(workspaceSlug: string, pageId: string): Promise<void> {
    return this.delete(`${this.base(workspaceSlug, pageId)}lock/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async fetchDescriptionBinary(workspaceSlug: string, pageId: string): Promise<ArrayBuffer> {
    return this.get(`${this.base(workspaceSlug, pageId)}description/`, {
      headers: {
        "Content-Type": "application/octet-stream",
      },
      responseType: "arraybuffer",
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateDescription(workspaceSlug: string, pageId: string, data: TDocumentPayload): Promise<void> {
    return this.patch(`${this.base(workspaceSlug, pageId)}description/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error;
      });
  }

  async duplicate(workspaceSlug: string, pageId: string): Promise<TPage> {
    return this.post(`${this.base(workspaceSlug, pageId)}duplicate/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async fetchAllVersions(workspaceSlug: string, pageId: string): Promise<TPageVersion[]> {
    return this.get(`${this.base(workspaceSlug, pageId)}versions/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async fetchVersionById(workspaceSlug: string, pageId: string, versionId: string): Promise<TPageVersion> {
    return this.get(`${this.base(workspaceSlug, pageId)}versions/${versionId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
