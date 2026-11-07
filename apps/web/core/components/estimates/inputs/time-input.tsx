/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { convertMinutesToHoursAndMinutes } from "@plane/utils";

type TEstimateTimeInputProps = {
  /** total duration in minutes */
  value?: string;
  handleEstimateInputValue: (value: string) => void;
};

const splitMinutes = (value: string | undefined): { hours: string; minutes: string } => {
  const totalMinutes = Number(value);
  if (!value || isNaN(totalMinutes) || totalMinutes <= 0) return { hours: "", minutes: "" };
  const { hours, minutes } = convertMinutesToHoursAndMinutes(totalMinutes);
  return { hours: hours ? `${hours}` : "", minutes: minutes ? `${minutes}` : "" };
};

const toTotalMinutes = (hours: string, minutes: string): string => {
  if (hours.trim() === "" && minutes.trim() === "") return "";
  const parsedHours = Number(hours || 0);
  const parsedMinutes = Number(minutes || 0);
  if (isNaN(parsedHours) || isNaN(parsedMinutes)) return "";
  return `${Math.round(parsedHours * 60 + parsedMinutes)}`;
};

export function EstimateTimeInput(props: TEstimateTimeInputProps) {
  const { value, handleEstimateInputValue } = props;
  // i18n
  const { t } = useTranslation();
  // states
  const [hours, setHours] = useState(() => splitMinutes(value).hours);
  const [minutes, setMinutes] = useState(() => splitMinutes(value).minutes);
  // refs
  const lastEmittedValue = useRef<string | undefined>(value);
  const hoursInputRef = useRef<HTMLInputElement>(null);

  // focus the hours field on mount, like the other estimate inputs
  useEffect(() => {
    hoursInputRef.current?.focus();
  }, []);

  // sync the fields when the value is changed from outside (e.g. when an existing value is loaded for editing)
  useEffect(() => {
    if (value === lastEmittedValue.current) return;
    lastEmittedValue.current = value;
    const split = splitMinutes(value);
    setHours(split.hours);
    setMinutes(split.minutes);
  }, [value]);

  const handleChange = (newHours: string, newMinutes: string) => {
    setHours(newHours);
    setMinutes(newMinutes);
    const totalMinutes = toTotalMinutes(newHours, newMinutes);
    lastEmittedValue.current = totalMinutes;
    handleEstimateInputValue(totalMinutes);
  };

  const inputClassName =
    "w-full min-w-0 border-none bg-transparent py-2 text-13 focus:border-0 focus:ring-0 focus:outline-none";

  return (
    <div className="flex w-full items-center gap-3 px-2">
      <label className="flex flex-1 items-center gap-1">
        <input
          ref={hoursInputRef}
          value={hours}
          onChange={(e) => handleChange(e.target.value, minutes)}
          className={inputClassName}
          placeholder={t("project_settings.estimates.create.time_input.hours")}
          aria-label={t("project_settings.estimates.create.time_input.hours")}
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
        />
        <span className="flex-shrink-0 text-13 text-tertiary">
          {t("project_settings.estimates.create.time_input.hours_unit")}
        </span>
      </label>
      <label className="flex flex-1 items-center gap-1">
        <input
          value={minutes}
          onChange={(e) => handleChange(hours, e.target.value)}
          className={inputClassName}
          placeholder={t("project_settings.estimates.create.time_input.minutes")}
          aria-label={t("project_settings.estimates.create.time_input.minutes")}
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
        />
        <span className="flex-shrink-0 text-13 text-tertiary">
          {t("project_settings.estimates.create.time_input.minutes_unit")}
        </span>
      </label>
    </div>
  );
}
