/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/** Meilenstein eines Projekts (Backend: plane.ext.milestones). */
export type TMilestone = {
  id: string;
  name: string;
  description: string;
  /** Kalendertag im Format YYYY-MM-DD */
  date: string;
  /** Hex-Farbe, z. B. #3F76FF */
  color: string;
  sort_order: number;
  project: string;
  workspace: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  /** verknüpfte Arbeitselemente (ohne gelöschte, archivierte, Entwürfe) */
  total_issues: number;
  /** davon in Status-Gruppe „completed“ */
  completed_issues: number;
  /** davon in Status-Gruppe „cancelled“ */
  cancelled_issues: number;
};

export type TMilestoneFormData = Pick<TMilestone, "name" | "date" | "color" | "description">;

export type TMilestoneProgress = {
  total: number;
  /** abgeschlossen + abgebrochen */
  done: number;
  open: number;
  /** 0–100 */
  percentage: number;
};
