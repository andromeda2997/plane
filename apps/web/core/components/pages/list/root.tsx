/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TPageNavigationTabs } from "@plane/types";
// components
import { ListLayout } from "@/components/core/list";
// plane web hooks
import type { EPageStoreType } from "@/hooks/store";
import { usePageStore } from "@/hooks/store";
import useLocalStorage from "@/hooks/use-local-storage";
// store
import { getChildIdsWithin, getDropPosition, getRootIdsWithin } from "@/store/pages/page-tree";
// local imports
import { PageListBlock } from "./block";
import type { TPageTreeDropKind } from "./tree-dnd-item";
import { PAGE_TREE_DRAG_TYPE, PageTreeDndItem, PageTreeTopLevelDropZone } from "./tree-dnd-item";

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
  onExpand: (pageId: string) => void;
  isDndEnabled: boolean;
  onDropPage: (sourceId: string, targetId: string, kind: TPageTreeDropKind) => void;
};

const PageTreeNode = observer(function PageTreeNode(props: TPageTreeNodeProps) {
  const { pageId, depth, visiblePageIds, storeType, expandedIds, onToggle, onExpand, isDndEnabled, onDropPage } = props;
  const { data } = usePageStore(storeType);
  const childIds = getChildIdsWithin(data, visiblePageIds, pageId);
  const isExpanded = expandedIds.has(pageId);

  return (
    <>
      <PageTreeDndItem
        pageId={pageId}
        storeType={storeType}
        depth={depth}
        isDndEnabled={isDndEnabled}
        hasVisibleChildren={childIds.length > 0}
        isExpanded={isExpanded}
        onExpand={onExpand}
        onDropPage={onDropPage}
      >
        <PageListBlock
          pageId={pageId}
          storeType={storeType}
          depth={depth}
          childCount={childIds.length}
          isExpanded={isExpanded}
          onToggleExpand={() => onToggle(pageId)}
        />
      </PageTreeDndItem>
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
            onExpand={onExpand}
            isDndEnabled={isDndEnabled}
            onDropPage={onDropPage}
          />
        ))}
    </>
  );
});

export const PagesListRoot = observer(function PagesListRoot(props: TPagesListRoot) {
  const { pageType, storeType } = props;
  // refs
  const listRef = useRef<HTMLDivElement | null>(null);
  // states
  const [isDraggingPage, setIsDraggingPage] = useState(false);
  // store hooks
  const { getCurrentProjectFilteredPageIdsByTab, data, filters, canCurrentUserCreatePage, getPageById } =
    usePageStore(storeType);
  const { t } = useTranslation();
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
  const handleExpand = useCallback(
    (pageId: string) => {
      if (expandedIds.has(pageId)) return;
      setExpandedList([...expandedIds, pageId]);
    },
    [expandedIds, setExpandedList]
  );
  // derived values
  const filteredPageIds = getCurrentProjectFilteredPageIdsByTab(pageType);
  // bei Suche/Filter flache Trefferliste, sonst Baum
  const hasActiveFilters =
    !!filters.searchQuery ||
    Object.values(filters.filters ?? {}).some((value) => (Array.isArray(value) ? value.length > 0 : !!value));
  /**
   * Drag-and-Drop nur bei manueller Sortierung: bei Name/Datum würde eine Seite nach dem Ablegen
   * sofort an ihre sortierte Stelle springen. Außerdem nicht in der Such-/Filteransicht (flache Liste),
   * nicht im Archiv und nicht für Gäste (Rolle unter Mitglied).
   */
  const isDndEnabled =
    filters.sortKey === "manual" && !hasActiveFilters && pageType !== "archived" && canCurrentUserCreatePage;

  /**
   * Angezeigte Geschwister einer Ebene in Anzeige-Reihenfolge. Maßgeblich ist das echte parent-Feld,
   * nicht die Einrückung: im Tab "Privat" stehen private Unterseiten öffentlicher Seiten oben.
   */
  const getVisibleSiblingIds = useCallback(
    (parentId: string | null) => (filteredPageIds ?? []).filter((id) => (data[id]?.parent ?? null) === parentId),
    [data, filteredPageIds]
  );

  const movePage = useCallback(
    async (sourceId: string, parentId: string | null, getInsertIndex: (siblingIds: string[]) => number) => {
      const page = getPageById(sourceId);
      if (!page) return;
      const siblingIds = getVisibleSiblingIds(parentId).filter((id) => id !== sourceId);
      const insertIndex = getInsertIndex(siblingIds);
      // gleiche Ebene und gleiche Position -> nichts zu tun
      if ((page.parent ?? null) === parentId) {
        const currentIds = getVisibleSiblingIds(parentId);
        const nextIds = [...siblingIds.slice(0, insertIndex), sourceId, ...siblingIds.slice(insertIndex)];
        if (currentIds.join() === nextIds.join()) return;
      }
      const position = getDropPosition(data, sourceId, parentId, siblingIds, insertIndex);
      if (parentId) handleExpand(parentId);
      try {
        await page.setPosition(position);
      } catch (error) {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: t("page_tree.toasts.move_failed"),
          message: (error as { error?: string } | undefined)?.error,
        });
      }
    },
    [data, getPageById, getVisibleSiblingIds, handleExpand, t]
  );

  const handleDropPage = useCallback(
    (sourceId: string, targetId: string, kind: TPageTreeDropKind) => {
      const target = getPageById(targetId);
      if (!target || sourceId === targetId) return;
      if (kind === "child") void movePage(sourceId, targetId, (siblings) => siblings.length);
      else if (kind === "first-child") void movePage(sourceId, targetId, () => 0);
      else
        void movePage(sourceId, target.parent ?? null, (siblings) => {
          const index = siblings.indexOf(targetId);
          if (index === -1) return siblings.length;
          return kind === "before" ? index : index + 1;
        });
    },
    [getPageById, movePage]
  );

  const handleDropTopLevelStart = useCallback((sourceId: string) => void movePage(sourceId, null, () => 0), [movePage]);
  const handleDropTopLevelEnd = useCallback(
    (sourceId: string) => void movePage(sourceId, null, (siblings) => siblings.length),
    [movePage]
  );

  const isTreeRendered = !!filteredPageIds && !hasActiveFilters;

  // Ablagefläche "oberste Ebene" nur während des Ziehens zeigen; Liste scrollt am Rand mit
  useEffect(() => {
    const element = listRef.current;
    if (!element || !isDndEnabled || !isTreeRendered) return;
    const isOwnDrag = (sourceData: Record<string | symbol, unknown>) =>
      sourceData?.type === PAGE_TREE_DRAG_TYPE && sourceData?.storeType === storeType;
    return combine(
      monitorForElements({
        canMonitor: ({ source }) => isOwnDrag(source.data),
        onDragStart: () => setIsDraggingPage(true),
        onDrop: () => setIsDraggingPage(false),
      }),
      autoScrollForElements({
        element,
        canScroll: ({ source }) => isOwnDrag(source.data),
        getAllowedAxis: () => "vertical",
      })
    );
  }, [isDndEnabled, isTreeRendered, storeType]);

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
    <ListLayout containerRef={listRef}>
      {isDndEnabled && (
        <PageTreeTopLevelDropZone
          storeType={storeType}
          isVisible={isDraggingPage}
          position="start"
          onDropPage={handleDropTopLevelStart}
        />
      )}
      {rootIds.map((pageId) => (
        <PageTreeNode
          key={pageId}
          pageId={pageId}
          depth={0}
          visiblePageIds={filteredPageIds}
          storeType={storeType}
          expandedIds={expandedIds}
          onToggle={handleToggle}
          onExpand={handleExpand}
          isDndEnabled={isDndEnabled}
          onDropPage={handleDropPage}
        />
      ))}
      {isDndEnabled && (
        <PageTreeTopLevelDropZone
          storeType={storeType}
          isVisible={isDraggingPage}
          position="end"
          onDropPage={handleDropTopLevelEnd}
        />
      )}
    </ListLayout>
  );
});
