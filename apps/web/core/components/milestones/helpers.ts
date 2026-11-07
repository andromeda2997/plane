/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TMilestone, TMilestoneProgress } from "@plane/types";
import { renderFormattedPayloadDate } from "@plane/utils";

/** Standard-Palette, identisch mit MILESTONE_COLORS im Backend. */
export const MILESTONE_COLORS = ["#3F76FF", "#16A34A", "#F59E0B", "#9333EA", "#0EA5E9", "#EC4899", "#64748B"];
export const DEFAULT_MILESTONE_COLOR = MILESTONE_COLORS[0];
/** Warnfarbe für überschrittene Meilensteine mit offenen Arbeitselementen. */
export const MILESTONE_OVERDUE_COLOR = "#DC2626";
export const MILESTONE_DESCRIPTION_MAX_LENGTH = 2000;
export const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

export const getMilestoneProgress = (milestone: TMilestone): TMilestoneProgress => {
  const total = milestone.total_issues ?? 0;
  const done = Math.min(total, (milestone.completed_issues ?? 0) + (milestone.cancelled_issues ?? 0));
  return {
    total,
    done,
    open: total - done,
    percentage: total > 0 ? Math.round((done / total) * 100) : 0,
  };
};

/** Heutiger Kalendertag (lokal) als YYYY-MM-DD. */
export const getTodayPayloadDate = (): string => renderFormattedPayloadDate(new Date()) ?? "";

/** Datum überschritten (vor heute, tagesgenau) und noch offene verknüpfte Arbeitselemente. */
export const isMilestoneOverdue = (milestone: TMilestone, today: string = getTodayPayloadDate()): boolean =>
  milestone.date < today && getMilestoneProgress(milestone).open > 0;

export const getMilestoneDisplayColor = (milestone: TMilestone, today?: string): string =>
  isMilestoneOverdue(milestone, today) ? MILESTONE_OVERDUE_COLOR : milestone.color || DEFAULT_MILESTONE_COLOR;
