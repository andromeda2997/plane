/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import useSWR from "swr";
// plane imports
import { useTranslation } from "@plane/i18n";
import { EmptyStateDetailed } from "@plane/propel/empty-state";
import type { TPageNavigationTabs } from "@plane/types";
// components
import { PagesListHeaderRoot } from "@/components/pages/header";
import { PagesListRoot } from "@/components/pages/list/root";
import { PageLoader } from "@/components/pages/loaders/page-loader";
// hooks
import { EPageStoreType, usePageStore } from "@/hooks/store";
// local imports
import { useCreateWikiPage } from "./use-create-wiki-page";

type Props = {
  workspaceSlug: string;
  pageType: TPageNavigationTabs;
};

const storeType = EPageStoreType.WORKSPACE;

export const WikiListContent = observer(function WikiListContent(props: Props) {
  const { workspaceSlug, pageType } = props;
  const { t } = useTranslation();
  const {
    fetchPagesList,
    loader,
    isAnyPageAvailable,
    canCurrentUserCreatePage,
    getCurrentProjectPageIdsByTab,
    getCurrentProjectFilteredPageIdsByTab,
  } = usePageStore(storeType);
  const { createWikiPage, isCreating } = useCreateWikiPage();

  useSWR(workspaceSlug ? `WIKI_PAGES_${workspaceSlug}` : null, () => fetchPagesList(workspaceSlug, ""));

  const pageIds = getCurrentProjectPageIdsByTab(pageType) ?? [];
  const filteredPageIds = getCurrentProjectFilteredPageIdsByTab(pageType) ?? [];

  const renderContent = () => {
    if (loader === "init-loader") return <PageLoader />;
    if (!isAnyPageAvailable || pageIds.length === 0) {
      if (pageType === "archived")
        return (
          <EmptyStateDetailed
            assetKey="page"
            title={t("project_empty_state.archive_pages.title")}
            description={t("project_empty_state.archive_pages.description")}
          />
        );
      return (
        <EmptyStateDetailed
          assetKey="page"
          title={t("wiki_light.empty_state.title")}
          description={t("wiki_light.empty_state.description")}
          actions={
            canCurrentUserCreatePage
              ? [
                  {
                    label: t("wiki_light.empty_state.cta"),
                    onClick: () => {
                      createWikiPage();
                    },
                    variant: "primary",
                    disabled: isCreating,
                  },
                ]
              : []
          }
        />
      );
    }
    if (filteredPageIds.length === 0)
      return (
        <EmptyStateDetailed
          assetKey="search"
          title={t("common_empty_state.search.title")}
          description={t("common_empty_state.search.description")}
        />
      );
    return (
      <div className="h-full w-full overflow-hidden">
        <PagesListRoot pageType={pageType} storeType={storeType} />
      </div>
    );
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      {isAnyPageAvailable && (
        <PagesListHeaderRoot
          pageType={pageType}
          projectId=""
          storeType={storeType}
          workspaceSlug={workspaceSlug}
          tabBaseHref={`/${workspaceSlug}/wiki`}
        />
      )}
      {renderContent()}
    </div>
  );
});
