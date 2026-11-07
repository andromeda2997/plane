/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { PageIcon } from "@plane/propel/icons";
import { Breadcrumbs, Header } from "@plane/ui";
// components
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
// hooks
import { EPageStoreType, usePageStore } from "@/hooks/store";
// local imports
import { useCreateWikiPage } from "./use-create-wiki-page";

export const WikiListHeader = observer(function WikiListHeader() {
  const { workspaceSlug } = useParams();
  const { t } = useTranslation();
  const { canCurrentUserCreatePage } = usePageStore(EPageStoreType.WORKSPACE);
  const { createWikiPage, isCreating } = useCreateWikiPage();

  return (
    <Header>
      <Header.LeftItem>
        <Breadcrumbs>
          <Breadcrumbs.Item
            component={
              <BreadcrumbLink
                label={t("wiki_light.title")}
                href={`/${workspaceSlug}/wiki/`}
                icon={<PageIcon className="h-4 w-4 text-tertiary" />}
                isLast
              />
            }
            isLast
          />
        </Breadcrumbs>
      </Header.LeftItem>
      {canCurrentUserCreatePage && (
        <Header.RightItem>
          <Button variant="primary" size="lg" onClick={() => createWikiPage()} loading={isCreating}>
            {t("wiki_light.new_page")}
          </Button>
        </Header.RightItem>
      )}
    </Header>
  );
});
