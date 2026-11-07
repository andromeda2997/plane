/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { computed, makeObservable } from "mobx";
import { computedFn } from "mobx-utils";
// plane imports
import { EPageAccess, EUserPermissions } from "@plane/constants";
import type { TPage } from "@plane/types";
// services
import { WorkspacePageService } from "@/services/page";
// store
import type { RootStore } from "@/store/root.store";
import { BasePage } from "./base-page";
import type { TPageInstance } from "./base-page";

const workspacePageService = new WorkspacePageService();

export type TWorkspacePage = TPageInstance;

/**
 * Seite im Workspace-Wiki. Rechte richten sich nach der Workspace-Rolle:
 * Admins/Mitglieder lesen und schreiben, Gäste lesen nur.
 */
export class WorkspacePage extends BasePage implements TWorkspacePage {
  constructor(store: RootStore, page: TPage) {
    const { workspaceSlug } = store.router;
    super(store, page, {
      update: async (payload) => {
        if (!workspaceSlug || !page.id) throw new Error("Missing required fields.");
        return await workspacePageService.update(workspaceSlug, page.id, payload);
      },
      updateDescription: async (document) => {
        if (!workspaceSlug || !page.id) throw new Error("Missing required fields.");
        await workspacePageService.updateDescription(workspaceSlug, page.id, document);
      },
      updateAccess: async (payload) => {
        if (!workspaceSlug || !page.id) throw new Error("Missing required fields.");
        await workspacePageService.updateAccess(workspaceSlug, page.id, payload);
      },
      lock: async () => {
        if (!workspaceSlug || !page.id) throw new Error("Missing required fields.");
        await workspacePageService.lock(workspaceSlug, page.id);
      },
      unlock: async () => {
        if (!workspaceSlug || !page.id) throw new Error("Missing required fields.");
        await workspacePageService.unlock(workspaceSlug, page.id);
      },
      archive: async () => {
        if (!workspaceSlug || !page.id) throw new Error("Missing required fields.");
        return await workspacePageService.archive(workspaceSlug, page.id);
      },
      restore: async () => {
        if (!workspaceSlug || !page.id) throw new Error("Missing required fields.");
        await workspacePageService.restore(workspaceSlug, page.id);
      },
      duplicate: async () => {
        if (!workspaceSlug || !page.id) throw new Error("Missing required fields.");
        const duplicatedPage = await workspacePageService.duplicate(workspaceSlug, page.id);
        // die Kopie direkt im Wiki-Store anlegen (bei Projekt-Seiten kommt sie über das Neuladen)
        store.workspacePages.addPageToStore(duplicatedPage);
        return duplicatedPage;
      },
      updatePosition: async (payload) => {
        if (!workspaceSlug || !page.id) throw new Error("Missing required fields.");
        return await workspacePageService.updatePosition(workspaceSlug, page.id, payload);
      },
    });
    makeObservable(this, {
      canCurrentUserAccessPage: computed,
      canCurrentUserEditPage: computed,
      canCurrentUserDuplicatePage: computed,
      canCurrentUserLockPage: computed,
      canCurrentUserChangeAccess: computed,
      canCurrentUserArchivePage: computed,
      canCurrentUserDeletePage: computed,
      canCurrentUserFavoritePage: computed,
      canCurrentUserMovePage: computed,
      isContentEditable: computed,
    });
  }

  private getWorkspaceRole = computedFn((): number | undefined => {
    const { workspaceSlug } = this.rootStore.router;
    if (!workspaceSlug) return undefined;
    const role = this.rootStore.user.permission.getWorkspaceRoleByWorkspaceSlug(workspaceSlug.toString());
    return typeof role === "number" ? role : undefined;
  });

  private get isMemberOrAdmin() {
    const role = this.getWorkspaceRole();
    return !!role && role >= EUserPermissions.MEMBER;
  }

  private get isAdmin() {
    return this.getWorkspaceRole() === EUserPermissions.ADMIN;
  }

  get canCurrentUserAccessPage() {
    return this.access === EPageAccess.PUBLIC || this.isCurrentUserOwner;
  }

  get canCurrentUserEditPage() {
    const isPagePublic = this.access === EPageAccess.PUBLIC;
    return (isPagePublic && this.isMemberOrAdmin) || (!isPagePublic && this.isCurrentUserOwner);
  }

  get canCurrentUserDuplicatePage() {
    return this.isMemberOrAdmin;
  }

  get canCurrentUserLockPage() {
    return this.isCurrentUserOwner || this.isAdmin;
  }

  get canCurrentUserChangeAccess() {
    return this.isCurrentUserOwner;
  }

  get canCurrentUserArchivePage() {
    return this.isCurrentUserOwner || this.isAdmin;
  }

  get canCurrentUserDeletePage() {
    return this.isCurrentUserOwner || this.isAdmin;
  }

  // Favoriten sind im CE-Frontend an Projekte gebunden -> im Wiki ausgeblendet
  get canCurrentUserFavoritePage() {
    return false;
  }

  // "Move" (in ein anderes Projekt) gibt es für Wiki-Seiten nicht; "Verschieben unter …" nutzt canCurrentUserEditPage
  get canCurrentUserMovePage() {
    return false;
  }

  get isContentEditable() {
    const isPublic = this.access === EPageAccess.PUBLIC;
    return (
      !this.archived_at &&
      !this.is_locked &&
      (this.isCurrentUserOwner ? this.isMemberOrAdmin : isPublic && this.isMemberOrAdmin)
    );
  }

  getRedirectionLink = computedFn(() => {
    const { workspaceSlug } = this.rootStore.router;
    return `/${workspaceSlug}/wiki/${this.id}`;
  });
}
