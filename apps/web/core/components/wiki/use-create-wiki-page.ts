/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
// plane imports
import { EPageAccess } from "@plane/constants";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TPage } from "@plane/types";
// hooks
import { EPageStoreType, usePageStore } from "@/hooks/store";
import { useAppRouter } from "@/hooks/use-app-router";

/**
 * Neue Wiki-Seite anlegen (privat, wenn der Tab "Privat" aktiv ist) und öffnen.
 */
export const useCreateWikiPage = () => {
  const [isCreating, setIsCreating] = useState(false);
  const router = useAppRouter();
  const { workspaceSlug } = useParams();
  const searchParams = useSearchParams();
  const { createPage } = usePageStore(EPageStoreType.WORKSPACE);

  const createWikiPage = useCallback(
    async (payload: Partial<TPage> = {}) => {
      setIsCreating(true);
      try {
        const page = await createPage({
          access: searchParams.get("type") === "private" ? EPageAccess.PRIVATE : EPageAccess.PUBLIC,
          ...payload,
        });
        if (page?.id) router.push(`/${workspaceSlug}/wiki/${page.id}`);
      } catch (error) {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: "Error!",
          message: (error as { error?: string } | undefined)?.error || "Page could not be created. Please try again.",
        });
      } finally {
        setIsCreating(false);
      }
    },
    [createPage, router, searchParams, workspaceSlug]
  );

  return { createWikiPage, isCreating };
};
