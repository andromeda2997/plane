/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TIssue, TRecurringWorkItem, TRecurringWorkItemFormData, TRecurringWorkItemWeekday } from "@plane/types";
import { sortBy } from "lodash-es";
import { getDate, renderFormattedPayloadDate } from "@plane/utils";

export const I18N_PREFIX = "project_settings.recurring_work_items";

/** API weekday order: 0 = Monday ... 6 = Sunday */
export const WEEKDAYS: TRecurringWorkItemWeekday[] = [0, 1, 2, 3, 4, 5, 6];

type TTranslate = (key: string, params?: Record<string, unknown>) => string;

/** Convert JavaScript's getDay() (0 = Sunday) to the API weekday (0 = Monday). */
export const toApiWeekday = (date: Date): TRecurringWorkItemWeekday =>
  ((date.getDay() + 6) % 7) as TRecurringWorkItemWeekday;

export const getDefaultFormData = (): TRecurringWorkItemFormData => {
  const today = new Date();
  return {
    name: "",
    description_html: "<p></p>",
    priority: "none",
    state_id: null,
    assignee_ids: [],
    label_ids: [],
    cycle_id: null,
    module_id: null,
    duration_days: 1,
    frequency: "weekly",
    interval: 1,
    weekdays: [toApiWeekday(today)],
    month_day: today.getDate(),
    create_days_before: 0,
    start_date: renderFormattedPayloadDate(today) ?? "",
    end_type: "never",
    end_date: null,
    max_occurrences: null,
    is_active: true,
  };
};

export const recurringWorkItemToFormData = (item: TRecurringWorkItem): TRecurringWorkItemFormData => ({
  name: item.name,
  description_html: item.description_html,
  priority: item.priority,
  state_id: item.state_id,
  assignee_ids: item.assignee_ids ?? [],
  label_ids: item.label_ids ?? [],
  cycle_id: item.cycle_id,
  module_id: item.module_id,
  duration_days: item.duration_days,
  frequency: item.frequency,
  interval: item.interval,
  weekdays: item.weekdays ?? [],
  month_day: item.month_day,
  create_days_before: item.create_days_before,
  start_date: item.start_date,
  end_type: item.end_type,
  end_date: item.end_date,
  max_occurrences: item.max_occurrences,
  is_active: item.is_active,
});

/** Prefill values from an existing work item ("Create as recurring"). */
export const workItemToFormData = (issue: Partial<TIssue>): Partial<TRecurringWorkItemFormData> => {
  const data: Partial<TRecurringWorkItemFormData> = {
    name: issue.name ?? "",
    description_html: issue.description_html || "<p></p>",
    priority: issue.priority ?? "none",
    state_id: issue.state_id ?? null,
    assignee_ids: issue.assignee_ids ?? [],
    label_ids: issue.label_ids ?? [],
    cycle_id: issue.cycle_id ?? null,
    module_id: issue.module_ids?.[0] ?? null,
  };
  const start = getDate(issue.start_date);
  const target = getDate(issue.target_date);
  if (start && target && target >= start) {
    data.duration_days = Math.round((target.getTime() - start.getTime()) / 86_400_000) + 1;
  }
  const anchor = start ?? target;
  if (anchor) {
    data.weekdays = [toApiWeekday(anchor)];
    data.month_day = anchor.getDate();
  }
  return data;
};

export const formatLocalDate = (date: string | null | undefined, locale: string): string => {
  const parsed = getDate(date);
  if (!parsed) return "";
  try {
    return parsed.toLocaleDateString(locale, { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return parsed.toDateString();
  }
};

/** Human readable rule, e.g. "Every week on Tuesday" / "Alle 2 Wochen am Montag, Donnerstag". */
export const getRuleSummary = (
  t: TTranslate,
  rule: Pick<
    TRecurringWorkItemFormData,
    "frequency" | "interval" | "weekdays" | "month_day" | "end_type" | "end_date" | "max_occurrences"
  >,
  locale: string
): string => {
  const interval = Math.max(rule.interval || 1, 1);
  let summary = "";
  if (rule.frequency === "daily") {
    summary = t(`${I18N_PREFIX}.summary.daily`, { interval });
  } else if (rule.frequency === "weekly") {
    const days = sortBy(rule.weekdays ?? [])
      .map((day) => t(`${I18N_PREFIX}.weekday_long.${day}`))
      .join(", ");
    summary = t(`${I18N_PREFIX}.summary.weekly`, { interval, days: days || "–" });
  } else {
    summary = t(`${I18N_PREFIX}.summary.monthly`, { interval, day: rule.month_day ?? "–" });
  }
  if (rule.end_type === "on_date" && rule.end_date) {
    summary += `, ${t(`${I18N_PREFIX}.summary.until`, { date: formatLocalDate(rule.end_date, locale) })}`;
  } else if (rule.end_type === "after_count" && rule.max_occurrences) {
    summary += `, ${t(`${I18N_PREFIX}.summary.times`, { count: rule.max_occurrences })}`;
  }
  return summary;
};

export type TFormErrors = Partial<Record<keyof TRecurringWorkItemFormData, string>>;

export const validateFormData = (t: TTranslate, data: TRecurringWorkItemFormData): TFormErrors => {
  const errors: TFormErrors = {};
  if (!data.name.trim()) errors.name = t(`${I18N_PREFIX}.validation.name_required`);
  if (data.frequency === "weekly" && data.weekdays.length === 0)
    errors.weekdays = t(`${I18N_PREFIX}.validation.weekdays_required`);
  if (data.frequency === "monthly" && (!data.month_day || data.month_day < 1 || data.month_day > 31))
    errors.month_day = t(`${I18N_PREFIX}.validation.month_day_required`);
  if (!data.start_date) errors.start_date = t(`${I18N_PREFIX}.validation.start_date_required`);
  if (data.end_type === "on_date") {
    if (!data.end_date) errors.end_date = t(`${I18N_PREFIX}.validation.end_date_required`);
    else if (data.start_date && data.end_date < data.start_date)
      errors.end_date = t(`${I18N_PREFIX}.validation.end_date_before_start`);
  }
  if (data.end_type === "after_count" && (!data.max_occurrences || data.max_occurrences < 1))
    errors.max_occurrences = t(`${I18N_PREFIX}.validation.max_occurrences_required`);
  return errors;
};

/** Payload for the API: drop values that do not belong to the selected rule. */
export const toPayload = (data: TRecurringWorkItemFormData): Partial<TRecurringWorkItemFormData> => ({
  ...data,
  name: data.name.trim(),
  weekdays: data.frequency === "weekly" ? data.weekdays : [],
  month_day: data.frequency === "monthly" ? data.month_day : null,
  end_date: data.end_type === "on_date" ? data.end_date : null,
  max_occurrences: data.end_type === "after_count" ? data.max_occurrences : null,
  duration_days: data.duration_days && data.duration_days > 0 ? data.duration_days : null,
});
