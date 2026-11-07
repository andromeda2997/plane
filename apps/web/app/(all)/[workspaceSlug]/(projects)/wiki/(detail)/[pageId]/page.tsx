/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useMemo } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import useSWR from "swr";
// plane imports
import { useTranslation } from "@plane/i18n";
import { getButtonStyling } from "@plane/propel/button";
import type { TSearchEntityRequestPayload, TWebhookConnectionQueryParams } from "@plane/types";
import { EFileAssetType } from "@plane/types";
import { cn } from "@plane/utils";
// components
import { LogoSpinner } from "@/components/common/logo-spinner";
import { PageHead } from "@/components/core/page-title";
import { IssuePeekOverview } from "@/components/issues/peek-overview";
import type { TPageRootConfig, TPageRootHandlers } from "@/components/pages/editor/page-root";
import { PageRoot } from "@/components/pages/editor/page-root";
// constants
import { WIKI_LIVE_PROJECT_ID } from "@/constants/wiki";
// hooks
import { useEditorConfig } from "@/hooks/editor";
import { EPageStoreType, usePage, usePageStore } from "@/hooks/store";
import { useEditorAsset } from "@/hooks/store/use-editor-asset";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useAppRouter } from "@/hooks/use-app-router";
// services
import { WorkspacePageService } from "@/services/page";
import { WorkspaceService } from "@/services/workspace.service";
import type { Route } from "./+types/page";

const workspaceService = new WorkspaceService();
const workspacePageService = new WorkspacePageService();

const storeType = EPageStoreType.WORKSPACE;

function WikiPageDetailsPage({ params }: Route.ComponentProps) {
  const router = useAppRouter();
  const { workspaceSlug, pageId } = params;
  const { t } = useTranslation();
  // store hooks
  const { createPage, fetchPageDetails } = usePageStore(storeType);
  const page = usePage({ pageId, storeType });
  const { getWorkspaceBySlug } = useWorkspace();
  const { uploadEditorAsset, duplicateEditorAsset } = useEditorAsset();
  // derived values
  const workspaceId = workspaceSlug ? (getWorkspaceBySlug(workspaceSlug)?.id ?? "") : "";
  const { canCurrentUserAccessPage, id, name, updateDescription } = page ?? {};
  // Erwähnungen/Verweise: workspaceweit suchen (kein Projekt)
  const fetchEntityCallback = useCallback(
    async (payload: TSearchEntityRequestPayload) => await workspaceService.searchEntity(workspaceSlug, payload),
    [workspaceSlug]
  );
  const { getEditorFileHandlers } = useEditorConfig();
  // Seitendetails laden
  const { error: pageDetailsError } = useSWR(
    `WIKI_PAGE_DETAILS_${pageId}`,
    () => fetchPageDetails(workspaceSlug, "", pageId),
    {
      revalidateIfStale: true,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
    }
  );

  const pageRootHandlers: TPageRootHandlers = useMemo(
    () => ({
      create: createPage,
      fetchAllVersions: async (versionPageId) =>
        await workspacePageService.fetchAllVersions(workspaceSlug, versionPageId),
      fetchDescriptionBinary: async () => {
        if (!id) return new ArrayBuffer(0);
        return await workspacePageService.fetchDescriptionBinary(workspaceSlug, id);
      },
      fetchEntity: fetchEntityCallback,
      fetchVersionDetails: async (versionPageId, versionId) =>
        await workspacePageService.fetchVersionById(workspaceSlug, versionPageId, versionId),
      // Wiederherstellen einer Version läuft (wie bei Projekt-Seiten) über den Editor-Inhalt
      restoreVersion: async () => {},
      getRedirectionLink: (linkPageId) =>
        linkPageId ? `/${workspaceSlug}/wiki/${linkPageId}` : `/${workspaceSlug}/wiki`,
      updateDescription: updateDescription ?? (async () => {}),
    }),
    [createPage, fetchEntityCallback, id, updateDescription, workspaceSlug]
  );

  const pageRootConfig: TPageRootConfig = useMemo(
    () => ({
      fileHandler: getEditorFileHandlers({
        uploadFile: async (blockId, file) => {
          const { asset_id } = await uploadEditorAsset({
            blockId,
            data: {
              entity_identifier: id ?? "",
              entity_type: EFileAssetType.PAGE_DESCRIPTION,
            },
            file,
            workspaceSlug,
          });
          return asset_id;
        },
        duplicateFile: async (assetId: string) => {
          const { asset_id } = await duplicateEditorAsset({
            assetId,
            entityId: id,
            entityType: EFileAssetType.PAGE_DESCRIPTION,
            workspaceSlug,
          });
          return asset_id;
        },
        workspaceId,
        workspaceSlug,
      }),
    }),
    [getEditorFileHandlers, workspaceId, workspaceSlug, uploadEditorAsset, id, duplicateEditorAsset]
  );

  // Der unveränderte Live-Server kennt nur "project_page"; das Backend bildet den Platzhalter
  // WIKI_LIVE_PROJECT_ID auf die Wiki-Endpunkte ab (siehe constants/wiki.ts).
  const webhookConnectionParams: TWebhookConnectionQueryParams = useMemo(
    () => ({
      documentType: "project_page",
      projectId: WIKI_LIVE_PROJECT_ID,
      workspaceSlug,
    }),
    [workspaceSlug]
  );

  useEffect(() => {
    if (page?.deleted_at && page?.id) router.push(pageRootHandlers.getRedirectionLink());
  }, [page?.deleted_at, page?.id, router, pageRootHandlers]);

  if ((!page || !id) && !pageDetailsError)
    return (
      <div className="grid size-full place-items-center">
        <LogoSpinner />
      </div>
    );

  if (pageDetailsError || !canCurrentUserAccessPage)
    return (
      <div className="flex h-full w-full flex-col items-center justify-center">
        <h3 className="text-center text-16 font-semibold">{t("wiki_light.not_found.title")}</h3>
        <p className="mt-3 text-center text-13 text-secondary">{t("wiki_light.not_found.description")}</p>
        <Link href={`/${workspaceSlug}/wiki`} className={cn(getButtonStyling("secondary", "base"), "mt-5")}>
          {t("wiki_light.not_found.back")}
        </Link>
      </div>
    );

  if (!page) return null;

  return (
    <>
      <PageHead title={name} />
      <div className="flex h-full flex-col justify-between">
        <div className="relative flex h-full w-full flex-shrink-0 flex-col overflow-hidden">
          <PageRoot
            config={pageRootConfig}
            handlers={pageRootHandlers}
            storeType={storeType}
            page={page}
            webhookConnectionParams={webhookConnectionParams}
            workspaceSlug={workspaceSlug}
          />
          <IssuePeekOverview />
        </div>
      </div>
    </>
  );
}

export default observer(WikiPageDetailsPage);
