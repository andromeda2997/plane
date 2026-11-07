/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { AlertTriangle, Flag } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import type { TMilestone } from "@plane/types";
import type { TContextMenuItem } from "@plane/ui";
import { ContextMenu } from "@plane/ui";
import { cn, renderFormattedDate, renderFormattedPayloadDate } from "@plane/utils";
// components
import { HEADER_HEIGHT } from "@/components/gantt-chart/constants";
// hooks
import { useMilestone } from "@/hooks/store/use-milestone";
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
// local imports
import { getMilestoneDisplayColor, getMilestoneProgress, getTodayPayloadDate, isMilestoneOverdue } from "../helpers";
import type { TMilestoneModalState } from "../modal";

/** Mindestweg in px, ab dem ein Zeigerdruck als Ziehen statt als Klick gilt. */
const DRAG_THRESHOLD = 3;
const FLAG_TOP = 4;
const FLAG_HEIGHT = 20;

type Props = {
  workspaceSlug: string;
  projectId: string;
  canEdit: boolean;
  onOpenModal: (state: TMilestoneModalState) => void;
};

type TDragState = {
  milestoneId: string;
  pointerId: number;
  startClientX: number;
  /** Abstand Zeiger ↔ Linie beim Greifen, damit das Fähnchen nicht zum Zeiger springt */
  grabOffset: number;
  moved: boolean;
  date: string;
};

/**
 * Meilensteine im Gantt eines Projekts: senkrechte, gestrichelte Linie über die ganze Höhe in der
 * Mitte des Tages, oben ein Fähnchen mit Namen (Tooltip mit Datum + Fortschritt).
 *
 * Positionen kommen ausschließlich aus den Timeline-Store-Helfern (`getPositionFromDateOnGantt`,
 * `getDateFromPositionOnGantt`) und hängen damit nur an `currentViewData` – beim Erweitern des
 * Diagramms nach links/rechts und beim Wechsel Woche/Monat/Quartal rechnet MobX sie neu.
 * Gerendert als Geschwister der Chart-Ansicht im scrollenden Inhaltscontainer, daher scrollen sie
 * horizontal mit; die Fähnchen kleben (sticky) oben im Kopfbereich.
 */
export const GanttMilestonesLayer = observer(function GanttMilestonesLayer(props: Props) {
  const { workspaceSlug, projectId, canEdit, onOpenModal } = props;
  const { t } = useTranslation();
  // refs
  const layerRef = useRef<HTMLDivElement>(null);
  const headerStripRef = useRef<HTMLDivElement>(null);
  const contextDateRef = useRef<string | undefined>(undefined);
  // nach echtem Ziehen das folgende click-Ereignis nicht als „Bearbeiten“ werten
  const suppressClickRef = useRef(false);
  // states
  const [drag, setDrag] = useState<TDragState | null>(null);
  // store hooks
  const { currentViewData, getPositionFromDateOnGantt, getDateFromPositionOnGantt } = useTimeLineChartStore();
  const { getProjectMilestones, fetchProjectMilestones, updateMilestone } = useMilestone();

  useEffect(() => {
    // bei jedem Öffnen des Gantt frisch laden (Fortschritt kann sich geändert haben)
    void fetchProjectMilestones(workspaceSlug, projectId).catch(() => undefined);
  }, [fetchProjectMilestones, workspaceSlug, projectId]);

  // Datum unter dem Zeiger beim Rechtsklick merken. ContextMenu (@plane/ui) stoppt das
  // contextmenu-Ereignis in der Bubble-Phase, daher hier in der Capture-Phase lauschen.
  const hasChart = !!currentViewData;
  const getDateFromClientXRef = useRef<(clientX: number) => string | undefined>(() => undefined);
  useEffect(() => {
    const element = headerStripRef.current;
    if (!element) return;
    const handleContextMenu = (event: MouseEvent) => {
      contextDateRef.current = getDateFromClientXRef.current(event.clientX);
    };
    element.addEventListener("contextmenu", handleContextMenu, true);
    return () => element.removeEventListener("contextmenu", handleContextMenu, true);
  }, [hasChart]);

  if (!currentViewData) return null;

  const { dayWidth, startDate, endDate } = currentViewData.data;
  const chartStart = renderFormattedPayloadDate(startDate) ?? "";
  const chartEnd = renderFormattedPayloadDate(endDate) ?? "";
  const today = getTodayPayloadDate();

  /** linke Kante des Tages → Mitte des Tages */
  const getX = (date: string) => {
    const position = getPositionFromDateOnGantt(date, 0);
    return position === undefined ? undefined : position + dayWidth / 2;
  };

  /** Zeigerposition (Viewport) → x im Diagramm; liest das Rechteck jedes Mal neu (Scrollen/Erweitern). */
  const getChartX = (clientX: number) => {
    const rect = layerRef.current?.getBoundingClientRect();
    return rect ? clientX - rect.left : undefined;
  };

  /** Zeigerposition → Kalendertag (rastet tageweise ein). */
  const getDateFromClientX = (clientX: number, grabOffset = 0) => {
    const chartX = getChartX(clientX);
    if (chartX === undefined) return undefined;
    // Mitte des Tages i liegt bei (i + 0.5) * dayWidth; minus halbe Breite → rundet auf Tag i
    const date = getDateFromPositionOnGantt(chartX - grabOffset - dayWidth / 2, 0);
    return date ? renderFormattedPayloadDate(date) : undefined;
  };

  getDateFromClientXRef.current = getDateFromClientX;

  const milestones = getProjectMilestones(projectId)
    .map((milestone) => ({
      milestone,
      date: drag?.milestoneId === milestone.id ? drag.date : milestone.date,
    }))
    .filter(({ date }) => date >= chartStart && date <= chartEnd);

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>, milestone: TMilestone) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (!canEdit) return;
    suppressClickRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      milestoneId: milestone.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      grabOffset: (getChartX(event.clientX) ?? 0) - (getX(milestone.date) ?? 0),
      moved: false,
      date: milestone.date,
    });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const moved = drag.moved || Math.abs(event.clientX - drag.startClientX) > DRAG_THRESHOLD;
    if (!moved) return;
    const pointerDate = getDateFromClientX(event.clientX, drag.grabOffset) ?? drag.date;
    // im sichtbaren Zeitraum halten, sonst würde das Fähnchen samt Pointer-Capture verschwinden
    const date = pointerDate < chartStart ? chartStart : pointerDate > chartEnd ? chartEnd : pointerDate;
    if (moved !== drag.moved || date !== drag.date) setDrag({ ...drag, moved, date });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>, milestone: TMilestone) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const { moved, date } = drag;
    setDrag(null);
    // ohne Bewegung: Bearbeiten öffnet der folgende click-Handler (öffnete das Modal schon hier,
    // würde Headless UI den nachfolgenden Klick als „außerhalb“ werten und es sofort schließen)
    if (!moved) return;
    suppressClickRef.current = true;
    if (date === milestone.date) return;
    updateMilestone(workspaceSlug, projectId, milestone.id, { date })
      .then(() =>
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: `${t("success")}!`,
          message: t("milestone.toast.moved", { name: milestone.name, date: renderFormattedDate(date) ?? date }),
        })
      )
      .catch(() => setToast({ type: TOAST_TYPE.ERROR, title: `${t("error")}!`, message: t("milestone.toast.error") }));
  };

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>, milestone: TMilestone) => {
    event.stopPropagation();
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (canEdit) onOpenModal({ milestoneId: milestone.id });
  };

  const contextMenuItems: TContextMenuItem[] = [
    {
      key: "create-milestone-here",
      title: t("milestone.create_here"),
      icon: Flag,
      action: () => onOpenModal({ date: contextDateRef.current ?? today }),
      shouldRender: canEdit,
    },
  ];

  return (
    <>
      {/* Linien: unterhalb der Blöcke (DOM-Reihenfolge vor dem Block-Container), ohne Zeigerereignisse */}
      <div ref={layerRef} className="pointer-events-none absolute inset-0" aria-hidden>
        {milestones.map(({ milestone, date }) => {
          const x = getX(date);
          if (x === undefined) return null;
          const color = getMilestoneDisplayColor({ ...milestone, date }, today);
          return (
            <div
              key={milestone.id}
              className={cn("absolute top-0 bottom-0 border-l-2 border-dashed", {
                "opacity-60": drag?.milestoneId === milestone.id,
              })}
              style={{ left: `${x - 1}px`, borderColor: color }}
            />
          );
        })}
      </div>
      {/* Fähnchen: über dem Kopfbereich (z-5), unter der klebenden Seitenleiste (z-10) */}
      <div className="pointer-events-none absolute inset-0 z-[6]">
        <div
          ref={headerStripRef}
          className={cn("pointer-events-auto sticky top-0 w-full", { "cursor-context-menu": canEdit })}
          style={{ height: `${HEADER_HEIGHT}px` }}
        >
          {milestones.map(({ milestone, date }) => {
            const x = getX(date);
            if (x === undefined) return null;
            const overdue = isMilestoneOverdue({ ...milestone, date }, today);
            const color = getMilestoneDisplayColor({ ...milestone, date }, today);
            const progress = getMilestoneProgress(milestone);
            const isDragging = drag?.milestoneId === milestone.id && drag.moved;
            const tooltipContent = (
              <div className="space-y-0.5 text-11">
                <div>{renderFormattedDate(date)}</div>
                <div>
                  {progress.total > 0
                    ? t("milestone.progress", { done: progress.done, total: progress.total })
                    : t("milestone.progress_none")}
                </div>
                {overdue && (
                  <div className="font-medium text-danger-primary">
                    {t("milestone.overdue", { count: progress.open })}
                  </div>
                )}
                {canEdit && <div className="text-tertiary">{t("milestone.drag_hint")}</div>}
              </div>
            );
            return (
              <div
                key={milestone.id}
                className="absolute"
                style={{ left: `${x - 1}px`, top: `${FLAG_TOP}px`, height: `${HEADER_HEIGHT - FLAG_TOP}px` }}
              >
                {/* Fahnenstange bis zum Ende des Kopfbereichs */}
                <div className="absolute top-0 bottom-0 left-0 border-l-2" style={{ borderColor: color }} />
                <Tooltip tooltipHeading={milestone.name} tooltipContent={tooltipContent} disabled={!!drag}>
                  <button
                    type="button"
                    className={cn(
                      "relative flex max-w-40 touch-none items-center gap-1 rounded-r-sm px-1.5 text-11 font-medium whitespace-nowrap text-white shadow-raised-100 outline-none select-none focus-visible:ring-2",
                      {
                        "cursor-grab": canEdit && !isDragging,
                        "cursor-grabbing": isDragging,
                        "cursor-default": !canEdit,
                      }
                    )}
                    style={{ backgroundColor: color, height: `${FLAG_HEIGHT}px` }}
                    onPointerDown={(event) => handlePointerDown(event, milestone)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={(event) => handlePointerUp(event, milestone)}
                    onPointerCancel={() => setDrag(null)}
                    onMouseDown={(event) => event.button === 0 && event.stopPropagation()}
                    onClick={(event) => handleClick(event, milestone)}
                    aria-label={`${milestone.name}, ${renderFormattedDate(date) ?? date}`}
                  >
                    {overdue ? (
                      <AlertTriangle className="size-3 flex-shrink-0" />
                    ) : (
                      <Flag className="size-3 flex-shrink-0" />
                    )}
                    <span className="truncate">{isDragging ? renderFormattedDate(date) : milestone.name}</span>
                  </button>
                </Tooltip>
              </div>
            );
          })}
        </div>
      </div>
      {canEdit && <ContextMenu parentRef={headerStripRef} items={contextMenuItems} />}
    </>
  );
});
