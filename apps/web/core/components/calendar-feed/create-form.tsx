/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TCalendarFeedCreatePayload, TCalendarFeedWithUrl } from "@plane/types";
import { ToggleSwitch } from "@plane/ui";
// hooks
import { useCalendarFeed } from "@/hooks/store/use-calendar-feed";

type Props = {
  workspaceSlug: string | null;
  payload: Omit<TCalendarFeedCreatePayload, "hide_completed">;
  onCreated: (feed: TCalendarFeedWithUrl) => void;
  children?: React.ReactNode;
};

/** Optionen + Knopf „Kalender-Link erzeugen“. */
export function CalendarFeedCreateForm(props: Props) {
  const { workspaceSlug, payload, onCreated, children } = props;
  const { t } = useTranslation();
  const { createFeed } = useCalendarFeed();
  // states
  const [hideCompleted, setHideCompleted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreate = async () => {
    if (!workspaceSlug) return;
    setIsSubmitting(true);
    try {
      const response = await createFeed(workspaceSlug, { ...payload, hide_completed: hideCompleted });
      onCreated(response);
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: `${t("error")}!`, message: t("calendar_feed.toasts.create_error") });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border-[0.5px] border-subtle px-4 py-4">
      {children}
      <label className="flex cursor-pointer items-center justify-between gap-4 text-13 text-secondary">
        <span>{t("calendar_feed.hide_completed")}</span>
        <ToggleSwitch value={hideCompleted} onChange={setHideCompleted} />
      </label>
      <div>
        <Button variant="primary" onClick={() => void handleCreate()} loading={isSubmitting} disabled={!workspaceSlug}>
          {t("calendar_feed.create")}
        </Button>
      </div>
    </div>
  );
}
