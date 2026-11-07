/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useSearchParams } from "next/navigation";
// plane imports
import { useTranslation } from "@plane/i18n";
import type { TPageNavigationTabs } from "@plane/types";
// components
import { PageHead } from "@/components/core/page-title";
import { WikiListContent } from "@/components/wiki/list-content";
import type { Route } from "./+types/page";

const getPageType = (pageType?: string | null): TPageNavigationTabs => {
  if (pageType === "private") return "private";
  if (pageType === "archived") return "archived";
  return "public";
};

function WikiPagesListPage({ params }: Route.ComponentProps) {
  const { workspaceSlug } = params;
  const searchParams = useSearchParams();
  const { t } = useTranslation();

  return (
    <>
      <PageHead title={t("wiki_light.title")} />
      <WikiListContent workspaceSlug={workspaceSlug} pageType={getPageType(searchParams.get("type"))} />
    </>
  );
}

export default observer(WikiPagesListPage);
