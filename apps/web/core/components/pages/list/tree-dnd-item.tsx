/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { pointerOutsideOfPreview } from "@atlaskit/pragmatic-drag-and-drop/element/pointer-outside-of-preview";
import { setCustomNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview";
import { attachInstruction, extractInstruction } from "@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item";
import { observer } from "mobx-react";
import { createRoot } from "react-dom/client";
// plane imports
import { useTranslation } from "@plane/i18n";
import { PageIcon } from "@plane/propel/icons";
import { Tooltip } from "@plane/propel/tooltip";
import { DragHandle } from "@plane/ui";
import { cn, getPageName } from "@plane/utils";
// hooks
import type { EPageStoreType } from "@/hooks/store";
import { usePage, usePageStore } from "@/hooks/store";
import { usePlatformOS } from "@/hooks/use-platform-os";

// Einrückung pro Ebene (muss zu PageListBlock passen)
export const PAGE_TREE_INDENT_PX = 20;
// so lange über einer eingeklappten Seite verweilen, bis sie aufklappt
const AUTO_EXPAND_DELAY_MS = 600;

export const PAGE_TREE_DRAG_TYPE = "PAGE_TREE_ITEM";

/**
 * before/after: zwischen zwei Seiten (gleiche Ebene wie die Zielseite)
 * first-child: unter einer aufgeklappten Seite ganz oben (Linie zwischen Seite und erster Unterseite)
 * child: auf die Seite -> als letzte Unterseite
 */
export type TPageTreeDropKind = "before" | "after" | "first-child" | "child";

export type TPageTreeDragData = {
  type: typeof PAGE_TREE_DRAG_TYPE;
  storeType: EPageStoreType;
  id: string;
};

const isPageTreeDragData = (data: Record<string | symbol, unknown>): data is TPageTreeDragData =>
  data?.type === PAGE_TREE_DRAG_TYPE && typeof data?.id === "string";

type Props = {
  pageId: string;
  storeType: EPageStoreType;
  depth: number;
  // Drag-and-Drop in dieser Liste aktiv (manuelle Sortierung, keine Suche/Filter, Rolle)
  isDndEnabled: boolean;
  hasVisibleChildren: boolean;
  isExpanded: boolean;
  onExpand: (pageId: string) => void;
  onDropPage: (sourceId: string, targetId: string, kind: TPageTreeDropKind) => void;
  children: React.ReactNode;
};

function PageDragPreview(props: { name: string }) {
  return (
    <div className="flex max-w-72 items-center gap-2 rounded-md border border-subtle bg-surface-1 px-3 py-2 text-13 text-primary shadow-raised-200">
      <PageIcon className="size-4 flex-shrink-0 text-tertiary" />
      <span className="truncate">{props.name}</span>
    </div>
  );
}

export const PageTreeDndItem = observer(function PageTreeDndItem(props: Props) {
  const { pageId, storeType, depth, isDndEnabled, hasVisibleChildren, isExpanded, onExpand, onDropPage, children } =
    props;
  // refs
  const rowRef = useRef<HTMLDivElement | null>(null);
  const dragHandleRef = useRef<HTMLButtonElement | null>(null);
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // states
  const [isDragging, setIsDragging] = useState(false);
  const [dropKind, setDropKind] = useState<TPageTreeDropKind | undefined>(undefined);
  // hooks
  const { t } = useTranslation();
  const { isMobile } = usePlatformOS();
  const page = usePage({ pageId, storeType });
  const { getDescendantPageIds } = usePageStore(storeType);
  // derived values
  const pageName = getPageName(page?.name);
  // gesperrte/archivierte Seiten und Seiten ohne Bearbeitungsrecht bleiben liegen
  const canDrag = isDndEnabled && !!page?.canCurrentUserEditPage && !page?.is_locked && !page?.archived_at;
  const canBeTarget = isDndEnabled && !!page && !page.archived_at;
  // aktuelle Werte für die Drag-Handler, ohne die Registrierung bei jeder Änderung neu aufzubauen
  // (z. B. beim automatischen Aufklappen mitten im Ziehen)
  const latest = useRef({ hasVisibleChildren, isExpanded, onExpand, onDropPage, getDescendantPageIds, pageName });
  latest.current = { hasVisibleChildren, isExpanded, onExpand, onDropPage, getDescendantPageIds, pageName };

  useEffect(() => {
    const element = rowRef.current;
    if (!element || !canBeTarget) return;

    const clearExpandTimer = () => {
      if (expandTimerRef.current) clearTimeout(expandTimerRef.current);
      expandTimerRef.current = undefined;
    };

    const getKind = (data: Record<string | symbol, unknown>): TPageTreeDropKind | undefined => {
      const instruction = extractInstruction(data);
      if (!instruction) return undefined;
      if (instruction.type === "reorder-above") return "before";
      if (instruction.type === "reorder-below")
        return latest.current.isExpanded && latest.current.hasVisibleChildren ? "first-child" : "after";
      if (instruction.type === "make-child") return "child";
      return undefined;
    };

    const cleanups = [
      dropTargetForElements({
        element,
        canDrop: ({ source }) => {
          const data = source.data;
          if (!isPageTreeDragData(data) || data.storeType !== storeType) return false;
          // nicht auf sich selbst und nicht unter eigene Unterseiten (Zyklus)
          if (data.id === pageId) return false;
          return !latest.current.getDescendantPageIds(data.id).includes(pageId);
        },
        getData: ({ input, element: targetElement }) =>
          attachInstruction(
            { id: pageId },
            {
              input,
              element: targetElement,
              currentLevel: depth,
              indentPerLevel: PAGE_TREE_INDENT_PX,
              mode: "standard",
            }
          ),
        onDrag: ({ self }) => {
          const kind = getKind(self.data);
          setDropKind((current) => (current === kind ? current : kind));
          // eingeklappte Seite mit Unterseiten klappt beim Verweilen auf
          if (kind === "child" && latest.current.hasVisibleChildren && !latest.current.isExpanded) {
            if (!expandTimerRef.current)
              expandTimerRef.current = setTimeout(() => {
                expandTimerRef.current = undefined;
                latest.current.onExpand(pageId);
              }, AUTO_EXPAND_DELAY_MS);
          } else clearExpandTimer();
        },
        onDragLeave: () => {
          clearExpandTimer();
          setDropKind(undefined);
        },
        onDrop: ({ self, source }) => {
          clearExpandTimer();
          setDropKind(undefined);
          const kind = getKind(self.data);
          const data = source.data;
          if (!kind || !isPageTreeDragData(data)) return;
          latest.current.onDropPage(data.id, pageId, kind);
        },
      }),
    ];

    if (canDrag && dragHandleRef.current) {
      cleanups.push(
        draggable({
          element,
          dragHandle: dragHandleRef.current,
          getInitialData: (): TPageTreeDragData => ({ type: PAGE_TREE_DRAG_TYPE, storeType, id: pageId }),
          onDragStart: () => setIsDragging(true),
          onDrop: () => setIsDragging(false),
          onGenerateDragPreview: ({ nativeSetDragImage }) => {
            setCustomNativeDragPreview({
              getOffset: pointerOutsideOfPreview({ x: "12px", y: "8px" }),
              render: ({ container }) => {
                const root = createRoot(container);
                root.render(<PageDragPreview name={latest.current.pageName} />);
                return () => root.unmount();
              },
              nativeSetDragImage,
            });
          },
        })
      );
    }

    return () => {
      clearExpandTimer();
      combine(...cleanups)();
    };
  }, [canBeTarget, canDrag, depth, pageId, storeType]);

  // Linie für "dazwischen": auf Höhe der künftigen Ebene eingerückt
  const lineDepth = dropKind === "first-child" ? depth + 1 : depth;
  const showLine = dropKind === "before" || dropKind === "after" || dropKind === "first-child";

  return (
    <div
      ref={rowRef}
      className={cn("group/page-tree-row relative", {
        "opacity-40": isDragging,
      })}
    >
      {children}
      {/* Hervorhebung für "hinein" (als Unterseite) */}
      {dropKind === "child" && (
        <div className="pointer-events-none absolute inset-0 rounded-sm bg-accent-primary/10 ring-2 ring-accent-strong ring-inset" />
      )}
      {showLine && (
        <div
          className={cn("pointer-events-none absolute right-0 z-10 h-0.5 bg-accent-primary", {
            "-top-px": dropKind === "before",
            "-bottom-px": dropKind !== "before",
          })}
          style={{ left: `calc(var(--padding-page-x) + ${lineDepth * PAGE_TREE_INDENT_PX}px)` }}
        >
          <span className="absolute top-1/2 -left-1 size-2 -translate-y-1/2 rounded-full border-2 border-accent-strong bg-surface-1" />
        </div>
      )}
      {canDrag && (
        <Tooltip tooltipContent={t("page_tree.dnd.drag_to_move")} position="top-start" isMobile={isMobile}>
          <span
            className={cn(
              "absolute top-1/2 left-0.5 z-10 hidden -translate-y-1/2 group-hover/page-tree-row:flex",
              isDragging && "flex"
            )}
          >
            <DragHandle ref={dragHandleRef} className="bg-transparent" />
          </span>
        </Tooltip>
      )}
    </div>
  );
});

/**
 * Ablagefläche ober-/unterhalb des Baums: Seite auf die oberste Ebene ganz nach oben bzw. unten verschieben.
 * Nur während eines Drag-Vorgangs sichtbar.
 */
export function PageTreeTopLevelDropZone(props: {
  storeType: EPageStoreType;
  isVisible: boolean;
  position: "start" | "end";
  onDropPage: (sourceId: string) => void;
}) {
  const { storeType, isVisible, position, onDropPage } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  const [isOver, setIsOver] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return dropTargetForElements({
      element,
      canDrop: ({ source }) => isPageTreeDragData(source.data) && source.data.storeType === storeType,
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: ({ source }) => {
        setIsOver(false);
        if (isPageTreeDragData(source.data)) onDropPage(source.data.id);
      },
    });
  }, [onDropPage, storeType, isVisible]);

  return (
    <div ref={ref} className={cn("px-page-x py-1", isVisible ? "block" : "hidden")}>
      <div
        className={cn(
          "flex items-center justify-center rounded-md border border-dashed border-subtle px-3 py-2 text-12 text-tertiary transition-colors",
          { "border-accent-strong bg-accent-primary/10 text-accent-primary": isOver }
        )}
      >
        {t(position === "start" ? "page_tree.dnd.drop_top_level" : "page_tree.dnd.drop_top_level_end")}
      </div>
    </div>
  );
}
