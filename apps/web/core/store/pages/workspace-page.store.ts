/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { set, unset } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// plane imports
import { EUserPermissions } from "@plane/constants";
import type { TPage, TPageFilters, TPageNavigationTabs } from "@plane/types";
import { filterPagesByPageType, getPageName, orderPages, shouldFilterPage } from "@plane/utils";
// services
import { WorkspacePageService } from "@/services/page";
// store
import type { CoreRootStore } from "../root.store";
import type { IProjectPageStore } from "./project-page.store";
import { getAncestorIds, getDescendantIds } from "./page-tree";
import type { TWorkspacePage } from "./workspace-page";
import { WorkspacePage } from "./workspace-page";

type TLoader = "init-loader" | "mutation-loader" | undefined;

type TError = { title: string; description: string };

/**
 * Store für das Workspace-Wiki. Gleiche Schnittstelle wie der Projekt-Seiten-Store, damit Liste,
 * Aktionen, Header und Editor unverändert wiederverwendet werden können; projectId-Argumente
 * werden ignoriert.
 */
export interface IWorkspacePageStore extends IProjectPageStore {
  data: Record<string, TWorkspacePage>;
  addPageToStore: (page: TPage) => void;
}

export class WorkspacePageStore implements IWorkspacePageStore {
  // observables
  loader: TLoader = "init-loader";
  data: Record<string, TWorkspacePage> = {};
  error: TError | undefined = undefined;
  filters: TPageFilters = {
    searchQuery: "",
    // Seitenbaum: standardmäßig manuelle Reihenfolge (Drag-and-Drop)
    sortKey: "manual",
    sortBy: "asc",
  };
  // service
  service: WorkspacePageService;
  rootStore: CoreRootStore;

  constructor(private store: CoreRootStore) {
    makeObservable(this, {
      loader: observable.ref,
      data: observable,
      error: observable,
      filters: observable,
      isAnyPageAvailable: computed,
      canCurrentUserCreatePage: computed,
      updateFilters: action,
      clearAllFilters: action,
      fetchPagesList: action,
      fetchPageDetails: action,
      createPage: action,
      removePage: action,
      addPageToStore: action,
    });
    this.rootStore = store;
    this.service = new WorkspacePageService();
  }

  private get currentWorkspaceId() {
    const { workspaceSlug } = this.store.router;
    if (!workspaceSlug) return undefined;
    return this.store.workspaceRoot.getWorkspaceBySlug(workspaceSlug.toString())?.id;
  }

  private getWorkspacePages = () => {
    const workspaceId = this.currentWorkspaceId;
    return Object.values(this.data ?? {}).filter((page) => !workspaceId || page.workspace === workspaceId);
  };

  get isAnyPageAvailable() {
    if (this.loader) return true;
    return this.getWorkspacePages().length > 0;
  }

  get canCurrentUserCreatePage() {
    const { workspaceSlug } = this.store.router;
    if (!workspaceSlug) return false;
    const role = this.store.user.permission.getWorkspaceRoleByWorkspaceSlug(workspaceSlug.toString());
    return typeof role === "number" && role >= EUserPermissions.MEMBER;
  }

  getCurrentProjectPageIdsByTab = computedFn((pageType: TPageNavigationTabs) => {
    const pages = filterPagesByPageType(pageType, this.getWorkspacePages());
    return pages.map((page) => page.id) as string[];
  });

  getCurrentProjectPageIds = computedFn(
    (_projectId?: string) => this.getWorkspacePages().map((page) => page.id) as string[]
  );

  getCurrentProjectFilteredPageIdsByTab = computedFn((pageType: TPageNavigationTabs) => {
    const pagesByType = filterPagesByPageType(pageType, this.getWorkspacePages());
    let filteredPages = pagesByType.filter(
      (p) =>
        getPageName(p.name).toLowerCase().includes(this.filters.searchQuery.toLowerCase()) &&
        shouldFilterPage(p, this.filters.filters)
    );
    filteredPages = orderPages(filteredPages, this.filters.sortKey, this.filters.sortBy);
    return filteredPages.map((page) => page.id) as string[];
  });

  getPageById = computedFn((pageId: string) => this.data?.[pageId] || undefined);

  getPageAncestorIds = computedFn((pageId: string) => getAncestorIds(this.data, pageId));

  getDescendantPageIds = computedFn((pageId: string) => getDescendantIds(this.data, pageId));

  updateFilters = <T extends keyof TPageFilters>(filterKey: T, filterValue: TPageFilters[T]) => {
    runInAction(() => {
      set(this.filters, [filterKey], filterValue);
    });
  };

  clearAllFilters = () =>
    runInAction(() => {
      set(this.filters, ["filters"], {});
    });

  addPageToStore = (page: TPage) => {
    if (!page?.id) return;
    const existingPage = this.getPageById(page.id);
    if (existingPage) existingPage.mutateProperties(page, false);
    else set(this.data, [page.id], new WorkspacePage(this.store, page));
  };

  fetchPagesList = async (workspaceSlug: string, _projectId?: string, _pageType?: TPageNavigationTabs) => {
    try {
      if (!workspaceSlug) return undefined;
      runInAction(() => {
        this.loader = this.getWorkspacePages().length > 0 ? "mutation-loader" : "init-loader";
        this.error = undefined;
      });
      const pages = await this.service.fetchAll(workspaceSlug);
      runInAction(() => {
        // Seiten, die es serverseitig nicht mehr gibt (z. B. von anderen gelöscht), entfernen
        const fetchedIds = new Set(pages.map((page) => page.id));
        const workspaceId = pages[0]?.workspace ?? this.currentWorkspaceId;
        Object.values(this.data).forEach((page) => {
          if (page.id && page.workspace === workspaceId && !fetchedIds.has(page.id)) unset(this.data, [page.id]);
        });
        for (const page of pages) {
          if (!page?.id) continue;
          const existingPage = this.getPageById(page.id);
          if (existingPage) {
            const { name: _name, ...otherFields } = page;
            existingPage.mutateProperties(otherFields, false);
          } else set(this.data, [page.id], new WorkspacePage(this.store, page));
        }
        this.loader = undefined;
      });
      return pages;
    } catch (error) {
      runInAction(() => {
        this.loader = undefined;
        this.error = { title: "Failed", description: "Failed to fetch the pages, Please try again later." };
      });
      throw error;
    }
  };

  fetchPageDetails = async (
    workspaceSlug: string,
    _projectId: string | undefined,
    pageId: string,
    _options?: { trackVisit?: boolean }
  ) => {
    try {
      if (!workspaceSlug || !pageId) return undefined;
      runInAction(() => {
        this.loader = this.getPageById(pageId) ? "mutation-loader" : "init-loader";
        this.error = undefined;
      });
      const page = await this.service.fetchById(workspaceSlug, pageId);
      runInAction(() => {
        if (page?.id) {
          const pageInstance = this.getPageById(page.id);
          if (pageInstance) pageInstance.mutateProperties(page, false);
          else set(this.data, [page.id], new WorkspacePage(this.store, page));
        }
        this.loader = undefined;
      });
      return page;
    } catch (error) {
      runInAction(() => {
        this.loader = undefined;
        this.error = { title: "Failed", description: "Failed to fetch the page, Please try again later." };
      });
      throw error;
    }
  };

  createPage = async (pageData: Partial<TPage>) => {
    try {
      const { workspaceSlug } = this.store.router;
      if (!workspaceSlug) return undefined;
      runInAction(() => {
        this.loader = "mutation-loader";
        this.error = undefined;
      });
      const page = await this.service.create(workspaceSlug, pageData);
      runInAction(() => {
        if (page?.id) set(this.data, [page.id], new WorkspacePage(this.store, page));
        this.loader = undefined;
      });
      return page;
    } catch (error) {
      runInAction(() => {
        this.loader = undefined;
        this.error = { title: "Failed", description: "Failed to create a page, Please try again later." };
      });
      throw error;
    }
  };

  removePage = async ({ pageId, shouldSync = true }: { pageId: string; shouldSync?: boolean }) => {
    try {
      const { workspaceSlug } = this.store.router;
      if (!workspaceSlug || !pageId) return undefined;
      if (shouldSync) await this.service.remove(workspaceSlug, pageId);
      runInAction(() => {
        // wie im Backend: Unterseiten rücken eine Ebene nach oben
        const parentId = this.data[pageId]?.parent ?? null;
        Object.values(this.data).forEach((page) => {
          if (page.parent === pageId) page.parent = parentId;
        });
        unset(this.data, [pageId]);
      });
    } catch (error) {
      runInAction(() => {
        this.loader = undefined;
        this.error = { title: "Failed", description: "Failed to delete a page, Please try again later." };
      });
      throw error;
    }
  };

  // Verschieben in ein Projekt wird für Wiki-Seiten nicht unterstützt
  movePage = async () => {
    throw new Error("Moving wiki pages to a project is not supported.");
  };
}
