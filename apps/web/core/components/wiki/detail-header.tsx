/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { useTranslation } from "@plane/i18n";
import { PageIcon } from "@plane/propel/icons";
import type { ICustomSearchSelectOption } from "@plane/types";
import { Breadcrumbs, BreadcrumbNavigationSearchDropdown, Header } from "@plane/ui";
import { getPageName } from "@plane/utils";
// components
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { PageAccessIcon } from "@/components/common/page-access-icon";
import { SwitcherIcon, SwitcherLabel } from "@/components/common/switcher-label";
import { PageHeaderActions } from "@/components/pages/header/actions";
import { renderPageAncestorBreadcrumbs } from "@/components/pages/header/ancestor-breadcrumbs";
import { PageSyncingBadge } from "@/components/pages/header/syncing-badge";
// hooks
import { EPageStoreType, usePage, usePageStore } from "@/hooks/store";
import { useAppRouter } from "@/hooks/use-app-router";

const storeType = EPageStoreType.WORKSPACE;

export const WikiPageDetailHeader = observer(function WikiPageDetailHeader() {
  const router = useAppRouter();
  const { workspaceSlug, pageId } = useParams();
  const { t } = useTranslation();
  const { getPageById, getCurrentProjectPageIds, getPageAncestorIds } = usePageStore(storeType);
  const page = usePage({ pageId: pageId?.toString() ?? "", storeType });

  if (!page) return null;

  const ancestorIds = getPageAncestorIds(pageId?.toString() ?? "");
  const switcherOptions = getCurrentProjectPageIds("")
    .map((id) => {
      const _page = getPageById(id);
      if (!_page || _page.archived_at) return;
      return {
        value: _page.id,
        query: _page.name,
        content: (
          <div className="flex items-center justify-between gap-2">
            <SwitcherLabel logo_props={_page.logo_props} name={getPageName(_page.name)} LabelIcon={PageIcon} />
            <PageAccessIcon {..._page} />
          </div>
        ),
      };
    })
    .filter((option) => option !== undefined) as ICustomSearchSelectOption[];

  return (
    <Header>
      <Header.LeftItem>
        <div>
          <Breadcrumbs>
            <Breadcrumbs.Item
              component={
                <BreadcrumbLink
                  label={t("wiki_light.title")}
                  href={`/${workspaceSlug}/wiki/`}
                  icon={<PageIcon className="h-4 w-4 text-tertiary" />}
                />
              }
            />
            {renderPageAncestorBreadcrumbs(ancestorIds, getPageById)}
            <Breadcrumbs.Item
              component={
                <BreadcrumbNavigationSearchDropdown
                  selectedItem={pageId?.toString() ?? ""}
                  navigationItems={switcherOptions}
                  onChange={(value: string) => router.push(`/${workspaceSlug}/wiki/${value}`)}
                  title={getPageName(page.name)}
                  icon={
                    <Breadcrumbs.Icon>
                      <SwitcherIcon logo_props={page.logo_props} LabelIcon={PageIcon} size={16} />
                    </Breadcrumbs.Icon>
                  }
                  isLast
                />
              }
            />
          </Breadcrumbs>
        </div>
      </Header.LeftItem>
      <Header.RightItem>
        <PageSyncingBadge syncStatus={page.isSyncingWithServer} />
        <PageHeaderActions page={page} storeType={storeType} />
      </Header.RightItem>
    </Header>
  );
});
