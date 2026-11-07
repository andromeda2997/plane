/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef } from "react";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { Logo } from "@plane/propel/emoji-icon-picker";
import { ChevronRightIcon, PageIcon } from "@plane/propel/icons";
// plane imports
import { cn, getPageName } from "@plane/utils";
// components
import { ListItem } from "@/components/core/list";
import { BlockItemAction } from "@/components/pages/list/block-item-action";
// hooks
import { usePlatformOS } from "@/hooks/use-platform-os";
// plane web hooks
import type { EPageStoreType } from "@/hooks/store";
import { usePage } from "@/hooks/store";

type TPageListBlock = {
  pageId: string;
  storeType: EPageStoreType;
  // Seitenbaum (optional; ohne diese Props wird ein flacher Eintrag gerendert)
  depth?: number;
  childCount?: number;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
};

const TREE_INDENT_PX = 20;

export const PageListBlock = observer(function PageListBlock(props: TPageListBlock) {
  const { pageId, storeType, depth, childCount = 0, isExpanded = false, onToggleExpand } = props;
  // refs
  const parentRef = useRef(null);
  // hooks
  const page = usePage({
    pageId,
    storeType,
  });
  const { isMobile } = usePlatformOS();
  const { t } = useTranslation();
  // handle page check
  if (!page) return null;
  // derived values
  const { name, logo_props, getRedirectionLink } = page;
  const isTreeItem = depth !== undefined;

  const pageIcon = logo_props?.in_use ? (
    <Logo logo={logo_props} size={16} type="lucide" />
  ) : (
    <PageIcon className="h-4 w-4 text-tertiary" />
  );

  return (
    <ListItem
      prependTitleElement={
        isTreeItem ? (
          <span className="flex items-center gap-1" style={{ paddingLeft: depth * TREE_INDENT_PX }}>
            {childCount > 0 ? (
              <button
                type="button"
                className="grid size-5 place-items-center rounded-sm text-tertiary hover:bg-layer-1"
                aria-label={t(isExpanded ? "page_tree.collapse" : "page_tree.expand")}
                aria-expanded={isExpanded}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggleExpand?.();
                }}
              >
                <ChevronRightIcon className={cn("size-3.5 transition-transform", { "rotate-90": isExpanded })} />
              </button>
            ) : (
              <span className="size-5" />
            )}
            {pageIcon}
          </span>
        ) : (
          pageIcon
        )
      }
      title={getPageName(name)}
      appendTitleElement={
        isTreeItem && childCount > 0 && !isExpanded ? (
          <span className="text-11 text-tertiary">{t("page_tree.sub_pages_count", { count: childCount })}</span>
        ) : undefined
      }
      itemLink={getRedirectionLink()}
      actionableItems={<BlockItemAction page={page} parentRef={parentRef} storeType={storeType} />}
      isMobile={isMobile}
      parentRef={parentRef}
    />
  );
});
