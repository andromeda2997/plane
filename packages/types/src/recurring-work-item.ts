/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TIssuePriorities } from "./issues";

export type TRecurringWorkItemFrequency = "daily" | "weekly" | "monthly";

export type TRecurringWorkItemEndType = "never" | "on_date" | "after_count";

/** Weekday numbers as used by the API: 0 = Monday ... 6 = Sunday (not JavaScript's getDay()). */
export type TRecurringWorkItemWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type TRecurringWorkItem = {
  id: string;
  project_id: string;
  workspace_id: string;
  name: string;
  description_html: string;
  priority: TIssuePriorities;
  state_id: string | null;
  assignee_ids: string[];
  label_ids: string[];
  cycle_id: string | null;
  module_id: string | null;
  /** Number of days from start to target date (1 = same day); null = no dates */
  duration_days: number | null;
  frequency: TRecurringWorkItemFrequency;
  interval: number;
  weekdays: TRecurringWorkItemWeekday[];
  month_day: number | null;
  create_days_before: number;
  /** YYYY-MM-DD */
  start_date: string;
  end_type: TRecurringWorkItemEndType;
  end_date: string | null;
  max_occurrences: number | null;
  is_active: boolean;
  /** YYYY-MM-DD, local date of the next occurrence in the project timezone */
  next_occurrence_date: string | null;
  next_run_at: string | null;
  last_occurrence_date: string | null;
  last_run_at: string | null;
  occurrence_count: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

export type TRecurringWorkItemFormData = Omit<
  TRecurringWorkItem,
  | "id"
  | "project_id"
  | "workspace_id"
  | "next_occurrence_date"
  | "next_run_at"
  | "last_occurrence_date"
  | "last_run_at"
  | "occurrence_count"
  | "created_at"
  | "updated_at"
  | "created_by"
>;

export type TRecurringWorkItemRun = {
  id: string;
  recurring_work_item: string;
  issue: string | null;
  issue_name: string | null;
  issue_sequence_id: number | null;
  occurrence_date: string;
  trigger: "scheduled" | "manual";
  status: "success" | "failed";
  error: string;
  warnings: string[];
  created_at: string;
};

export type TRecurringWorkItemRunResponse = {
  run: TRecurringWorkItemRun;
  recurring_work_item: TRecurringWorkItem;
};
