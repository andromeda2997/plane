/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Outlet } from "react-router";
import useSWR from "swr";
import { AppHeader } from "@/components/core/app-header";
import { ContentWrapper } from "@/components/core/content-wrapper";
import { WikiPageDetailHeader } from "@/components/wiki/detail-header";
import { EPageStoreType, usePageStore } from "@/hooks/store";
import type { Route } from "./+types/layout";

export default function WikiPageDetailLayout({ params }: Route.ComponentProps) {
  const { workspaceSlug } = params;
  const { fetchPagesList } = usePageStore(EPageStoreType.WORKSPACE);
  // Seitenliste für Breadcrumb, Baum und "Verschieben unter …"
  useSWR(workspaceSlug ? `WIKI_PAGES_${workspaceSlug}` : null, () => fetchPagesList(workspaceSlug, ""));
  return (
    <>
      <AppHeader header={<WikiPageDetailHeader />} />
      <ContentWrapper>
        <Outlet />
      </ContentWrapper>
    </>
  );
}
