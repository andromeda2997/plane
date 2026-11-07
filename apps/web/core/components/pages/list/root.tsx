/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useMemo } from "react";
import { observer } from "mobx-react";
// types
import type { TPageNavigationTabs } from "@plane/types";
// components
import { ListLayout } from "@/components/core/list";
// plane web hooks
import type { EPageStoreType } from "@/hooks/store";
import { usePageStore } from "@/hooks/store";
import useLocalStorage from "@/hooks/use-local-storage";
// store
import { getChildIdsWithin, getRootIdsWithin } from "@/store/pages/page-tree";
// local imports
import { PageListBlock } from "./block";

type TPagesListRoot = {
  pageType: TPageNavigationTabs;
  storeType: EPageStoreType;
};

type TPageTreeNodeProps = {
  pageId: string;
  depth: number;
  visiblePageIds: string[];
  storeType: EPageStoreType;
  expandedIds: Set<string>;
  onToggle: (pageId: string) => void;
};

const PageTreeNode = observer(function PageTreeNode(props: TPageTreeNodeProps) {
  const { pageId, depth, visiblePageIds, storeType, expandedIds, onToggle } = props;
  const { data } = usePageStore(storeType);
  const childIds = getChildIdsWithin(data, visiblePageIds, pageId);
  const isExpanded = expandedIds.has(pageId);

  return (
    <>
      <PageListBlock
        pageId={pageId}
        storeType={storeType}
        depth={depth}
        childCount={childIds.length}
        isExpanded={isExpanded}
        onToggleExpand={() => onToggle(pageId)}
      />
      {isExpanded &&
        childIds.map((childId) => (
          <PageTreeNode
            key={childId}
            pageId={childId}
            depth={depth + 1}
            visiblePageIds={visiblePageIds}
            storeType={storeType}
            expandedIds={expandedIds}
            onToggle={onToggle}
          />
        ))}
    </>
  );
});

export const PagesListRoot = observer(function PagesListRoot(props: TPagesListRoot) {
  const { pageType, storeType } = props;
  // store hooks
  const { getCurrentProjectFilteredPageIdsByTab, data, filters } = usePageStore(storeType);
  // aufgeklappte Seiten (pro Store-Typ im Browser gemerkt)
  const { storedValue: expandedList, setValue: setExpandedList } = useLocalStorage<string[]>(
    `page_tree_expanded_${storeType}`,
    []
  );
  const expandedIds = useMemo(() => new Set(expandedList ?? []), [expandedList]);
  const handleToggle = useCallback(
    (pageId: string) => {
      const next = new Set(expandedIds);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      setExpandedList([...next]);
    },
    [expandedIds, setExpandedList]
  );
  // derived values
  const filteredPageIds = getCurrentProjectFilteredPageIdsByTab(pageType);
  // bei Suche/Filter flache Trefferliste, sonst Baum
  const hasActiveFilters =
    !!filters.searchQuery ||
    Object.values(filters.filters ?? {}).some((value) => (Array.isArray(value) ? value.length > 0 : !!value));

  if (!filteredPageIds) return <></>;

  if (hasActiveFilters)
    return (
      <ListLayout>
        {filteredPageIds.map((pageId) => (
          <PageListBlock key={pageId} pageId={pageId} storeType={storeType} />
        ))}
      </ListLayout>
    );

  const rootIds = getRootIdsWithin(data, filteredPageIds);
  return (
    <ListLayout>
      {rootIds.map((pageId) => (
        <PageTreeNode
          key={pageId}
          pageId={pageId}
          depth={0}
          visiblePageIds={filteredPageIds}
          storeType={storeType}
          expandedIds={expandedIds}
          onToggle={handleToggle}
        />
      ))}
    </ListLayout>
  );
});
