/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type React from "react";
import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IGanttBlock } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
// local imports
import type { TDependencyAnchor } from "./helpers";

const BLOCK_ELEMENT_SELECTOR = '[id^="gantt-block-"]';

type Props = {
  block: IGanttBlock;
  isMoving: boolean;
};

/**
 * Small connection points on the start and end edge of a block. Dragging one of them onto another block
 * creates a dependency between the two work items (end -> start: blocking, start -> start: starts before,
 * end -> end: finishes before).
 */
export const GanttDependencyHandles = observer(function GanttDependencyHandles(props: Props) {
  const { block, isMoving } = props;
  const { t } = useTranslation();
  const timelineStore = useTimeLineChartStore();
  const { isDependencyEnabled, dependencyDraft } = timelineStore;

  if (!isDependencyEnabled || isMoving) return null;

  const handleMouseDown = (e: React.MouseEvent<HTMLButtonElement>, sourceAnchor: TDependencyAnchor) => {
    if (e.button !== 0) return;
    const sourceElement = e.currentTarget.closest(BLOCK_ELEMENT_SELECTOR);
    const container = sourceElement?.parentElement;
    if (!sourceElement || !container) return;

    e.preventDefault();
    e.stopPropagation();

    const toChartPosition = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    // finds the block under the pointer and the edge of it the connection would attach to
    const findTarget = (event: MouseEvent): { targetId?: string; targetAnchor?: TDependencyAnchor } => {
      const targetElement = document
        .elementsFromPoint(event.clientX, event.clientY)
        .map((element) => element.closest(BLOCK_ELEMENT_SELECTOR))
        .find((element) => element && element !== sourceElement && element.parentElement === container);
      if (!targetElement) return {};

      const targetId = targetElement.id.replace("gantt-block-", "");
      const target = timelineStore.getBlockById(targetId);
      if (!target || timelineStore.getRelatedBlockIds(block.id).includes(targetId)) return {};

      const rect = targetElement.getBoundingClientRect();
      const isOnStartHalf = event.clientX < rect.left + rect.width / 2;
      let targetAnchor: TDependencyAnchor | undefined;
      if (sourceAnchor === "START") targetAnchor = target.start_date ? "START" : undefined;
      else if (isOnStartHalf) targetAnchor = target.start_date ? "START" : target.target_date ? "END" : undefined;
      else targetAnchor = target.target_date ? "END" : target.start_date ? "START" : undefined;

      return targetAnchor ? { targetId, targetAnchor } : {};
    };

    timelineStore.setDependencyDraft({
      sourceId: block.id,
      sourceAnchor,
      pointer: toChartPosition(e.nativeEvent),
    });

    const handleMouseMove = (event: MouseEvent) => {
      timelineStore.setDependencyDraft({
        sourceId: block.id,
        sourceAnchor,
        pointer: toChartPosition(event),
        ...findTarget(event),
      });
    };

    const cleanup = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("keydown", handleKeyDown);
    };

    const handleMouseUp = () => {
      cleanup();
      const draft = timelineStore.dependencyDraft;
      timelineStore.setDependencyDraft(undefined);
      if (!draft?.targetId || !draft.targetAnchor) return;
      timelineStore
        .createBlockDependency({ ...draft, targetId: draft.targetId, targetAnchor: draft.targetAnchor })
        .catch(() => {
          setToast({
            type: TOAST_TYPE.ERROR,
            title: t("toast.error"),
            message: t("issue.dependency.create_error"),
          });
        });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      cleanup();
      timelineStore.setDependencyDraft(undefined);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("keydown", handleKeyDown);
  };

  const renderHandle = (anchor: TDependencyAnchor) => {
    const isActive = dependencyDraft?.sourceId === block.id && dependencyDraft.sourceAnchor === anchor;
    return (
      <button
        type="button"
        aria-label={t(anchor === "START" ? "issue.dependency.handle_start" : "issue.dependency.handle_end")}
        title={t(anchor === "START" ? "issue.dependency.handle_start" : "issue.dependency.handle_end")}
        onMouseDown={(e) => handleMouseDown(e, anchor)}
        className={cn(
          "shadow-sm absolute top-1/2 z-[7] size-3 -translate-y-1/2 cursor-crosshair rounded-full bg-accent-primary opacity-0 transition-opacity",
          anchor === "START" ? "-left-5" : "-right-5",
          dependencyDraft ? "pointer-events-none" : "group-hover:opacity-100",
          { "opacity-100": isActive }
        )}
      />
    );
  };

  return (
    <>
      {block.start_date && renderHandle("START")}
      {block.target_date && renderHandle("END")}
    </>
  );
});
