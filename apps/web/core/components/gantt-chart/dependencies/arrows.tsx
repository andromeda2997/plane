/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { AlertModalCore } from "@plane/ui";
// components
import { ISSUE_RELATION_OPTIONS } from "@/components/relations";
// hooks
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
// local imports
import { BLOCK_HEIGHT } from "../constants";
import type { TDependencyAnchor, TGanttDependency } from "./helpers";
import { DEPENDENCY_ANCHORS, getAnchorX, isDependencyViolated } from "./helpers";

type Props = {
  blockIds: string[] | undefined;
  showAllBlocks: boolean;
  width: number;
};

type TPoint = { x: number; y: number };

const MARKERS = {
  default: { id: "gantt-dependency-arrow", className: "text-placeholder" },
  active: { id: "gantt-dependency-arrow-active", className: "text-accent-primary" },
  violated: { id: "gantt-dependency-arrow-violated", className: "text-danger-primary" },
} as const;

// direction in which a connection leaves or enters a block edge: to the left at the start, to the right at the end
const getAnchorDirection = (anchor: TDependencyAnchor) => (anchor === "START" ? -1 : 1);

/**
 * Smooth cubic curve between two block edges. The control points stick out of the edges horizontally,
 * so the curve always leaves and enters a block sideways, even when the target lies behind the source.
 */
const getCurvePath = (from: TPoint, fromAnchor: TDependencyAnchor, to: TPoint, toAnchor?: TDependencyAnchor) => {
  const reach = Math.min(Math.max(Math.abs(to.x - from.x) / 2, 24), 120);
  const controlFromX = from.x + getAnchorDirection(fromAnchor) * reach;
  const controlToX = toAnchor ? to.x + getAnchorDirection(toAnchor) * reach : to.x;
  return `M ${from.x} ${from.y} C ${controlFromX} ${from.y}, ${controlToX} ${to.y}, ${to.x} ${to.y}`;
};

/**
 * Draws the dependency arrows between the blocks of the timeline, the connection that is currently
 * being dragged from a block edge, and the dialog to remove a dependency when an arrow is clicked.
 */
export const GanttDependencyArrows = observer(function GanttDependencyArrows(props: Props) {
  const { blockIds, showAllBlocks, width } = props;
  const { t } = useTranslation();
  const timelineStore = useTimeLineChartStore();
  const { isDependencyEnabled, getBlockById, activeBlockId, dependencyDraft } = timelineStore;
  // states
  const [selectedDependency, setSelectedDependency] = useState<TGanttDependency | undefined>();
  const [isRemoving, setIsRemoving] = useState(false);

  if (!isDependencyEnabled || !blockIds?.length) return null;

  // vertical position of every rendered block, mirrors the rendering rules of GanttChartBlock
  const rowIndexById = new Map<string, number>();
  for (const blockId of blockIds) {
    const block = getBlockById(blockId);
    if (!block?.data || (!showAllBlocks && !block.start_date && !block.target_date)) continue;
    rowIndexById.set(blockId, rowIndexById.size);
  }

  const getAnchorPoint = (blockId: string, anchor: TDependencyAnchor): TPoint | undefined => {
    const block = getBlockById(blockId);
    const rowIndex = rowIndexById.get(blockId);
    if (!block?.position || rowIndex === undefined) return undefined;
    if (anchor === "START" ? !block.start_date : !block.target_date) return undefined;
    return { x: getAnchorX(block.position, anchor), y: rowIndex * BLOCK_HEIGHT + BLOCK_HEIGHT / 2 };
  };

  // called on the store object, getBlockDependencies is a class method and needs `this`
  const arrows = timelineStore.getBlockDependencies().flatMap((dependency) => {
    const { from, to } = DEPENDENCY_ANCHORS[dependency.type];
    const start = getAnchorPoint(dependency.predecessorId, from);
    const end = getAnchorPoint(dependency.successorId, to);
    const predecessorPosition = getBlockById(dependency.predecessorId)?.position;
    const successorPosition = getBlockById(dependency.successorId)?.position;
    if (!start || !end || !predecessorPosition || !successorPosition) return [];
    return [
      {
        dependency,
        path: getCurvePath(start, from, end, to),
        isViolated: isDependencyViolated(dependency.type, predecessorPosition, successorPosition),
        isActive: activeBlockId === dependency.predecessorId || activeBlockId === dependency.successorId,
      },
    ];
  });

  // connection that is being dragged from a block edge
  let draftPath: string | undefined;
  if (dependencyDraft) {
    const start = getAnchorPoint(dependencyDraft.sourceId, dependencyDraft.sourceAnchor);
    const snappedEnd =
      dependencyDraft.targetId && dependencyDraft.targetAnchor
        ? getAnchorPoint(dependencyDraft.targetId, dependencyDraft.targetAnchor)
        : undefined;
    if (start)
      draftPath = getCurvePath(
        start,
        dependencyDraft.sourceAnchor,
        snappedEnd ?? dependencyDraft.pointer,
        snappedEnd ? dependencyDraft.targetAnchor : undefined
      );
  }

  const handleRemove = async () => {
    if (!selectedDependency) return;
    setIsRemoving(true);
    try {
      await timelineStore.removeBlockDependency(selectedDependency);
      setSelectedDependency(undefined);
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: t("toast.error"), message: t("issue.dependency.remove_error") });
    } finally {
      setIsRemoving(false);
    }
  };

  const predecessor = selectedDependency ? getBlockById(selectedDependency.predecessorId) : undefined;
  const successor = selectedDependency ? getBlockById(selectedDependency.successorId) : undefined;

  return (
    <>
      {(arrows.length > 0 || draftPath) && (
        <svg
          className="pointer-events-none absolute top-0 left-0 z-[4] overflow-visible"
          width={width}
          height={rowIndexById.size * BLOCK_HEIGHT}
          data-testid="gantt-dependency-arrows"
        >
          <defs>
            {Object.values(MARKERS).map((marker) => (
              <marker
                key={marker.id}
                id={marker.id}
                className={marker.className}
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" />
              </marker>
            ))}
          </defs>
          {/* active and violated arrows are drawn last so they stay on top */}
          {[
            ...arrows.filter((arrow) => !arrow.isActive && !arrow.isViolated),
            ...arrows.filter((arrow) => arrow.isActive || arrow.isViolated),
          ].map((arrow) => {
            const marker = arrow.isViolated ? MARKERS.violated : arrow.isActive ? MARKERS.active : MARKERS.default;
            return (
              <g key={arrow.dependency.id}>
                <path
                  d={arrow.path}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={arrow.isActive ? 2 : 1.5}
                  strokeDasharray={arrow.isViolated ? "4 3" : undefined}
                  className={marker.className}
                  markerEnd={`url(#${marker.id})`}
                />
                {/* wide invisible stroke that makes the arrow easy to click */}
                {/* oxlint-disable-next-line jsx_a11y/no-static-element-interactions, jsx_a11y/click-events-have-key-events */}
                <path
                  d={arrow.path}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={12}
                  className="cursor-pointer"
                  style={{ pointerEvents: "stroke" }}
                  onClick={() => setSelectedDependency(arrow.dependency)}
                  onMouseEnter={() => timelineStore.updateActiveBlockId(arrow.dependency.successorId)}
                  onMouseLeave={() => timelineStore.updateActiveBlockId(null)}
                >
                  <title>{t("issue.dependency.remove_title")}</title>
                </path>
              </g>
            );
          })}
          {draftPath && (
            <path
              d={draftPath}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeDasharray={dependencyDraft?.targetId ? undefined : "5 4"}
              className={MARKERS.active.className}
              markerEnd={dependencyDraft?.targetId ? `url(#${MARKERS.active.id})` : undefined}
            />
          )}
        </svg>
      )}
      <AlertModalCore
        isOpen={!!selectedDependency}
        handleClose={() => !isRemoving && setSelectedDependency(undefined)}
        handleSubmit={handleRemove}
        isSubmitting={isRemoving}
        title={t("issue.dependency.remove_title")}
        primaryButtonText={{ default: t("issue.dependency.remove"), loading: t("issue.dependency.removing") }}
        content={
          selectedDependency && (
            <span className="flex flex-col gap-1">
              <span className="font-medium text-primary">{predecessor?.name}</span>
              <span>{t(ISSUE_RELATION_OPTIONS[selectedDependency.relationType].i18n_label)}</span>
              <span className="font-medium text-primary">{successor?.name}</span>
              <span className="mt-2">{t("issue.dependency.remove_description")}</span>
            </span>
          )
        }
      />
    </>
  );
});
