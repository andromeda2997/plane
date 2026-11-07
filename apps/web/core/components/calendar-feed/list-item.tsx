/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TCalendarFeed, TCalendarFeedWithUrl } from "@plane/types";
import { AlertModalCore } from "@plane/ui";
import { calculateTimeAgo, renderFormattedDate } from "@plane/utils";
// hooks
import { useCalendarFeed } from "@/hooks/store/use-calendar-feed";

type Props = {
  feed: TCalendarFeed;
  /** Bereich (Projekt/Meine Arbeitselemente und Workspace) mit anzeigen. */
  showScope?: boolean;
  onRegenerated: (feed: TCalendarFeedWithUrl) => void;
};

export const CalendarFeedListItem = observer(function CalendarFeedListItem(props: Props) {
  const { feed, showScope = false, onRegenerated } = props;
  const { t } = useTranslation();
  const { revokeFeed, regenerateFeed } = useCalendarFeed();
  // states
  const [modal, setModal] = useState<"revoke" | "regenerate" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const scopeLabel =
    feed.scope === "project"
      ? t("calendar_feed.scope_project", { identifier: feed.project_identifier ?? "" })
      : t("calendar_feed.scope_my_work_items");

  const closeModal = () => {
    setModal(null);
    setIsSubmitting(false);
  };

  const handleRevoke = async () => {
    setIsSubmitting(true);
    try {
      await revokeFeed(feed.workspace_slug, feed.id);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: `${t("success")}!`,
        message: t("calendar_feed.toasts.revoke_success"),
      });
      closeModal();
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: `${t("error")}!`, message: t("calendar_feed.toasts.revoke_error") });
      setIsSubmitting(false);
    }
  };

  const handleRegenerate = async () => {
    setIsSubmitting(true);
    try {
      const response = await regenerateFeed(feed.workspace_slug, feed.id);
      closeModal();
      onRegenerated(response);
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: `${t("error")}!`,
        message: t("calendar_feed.toasts.regenerate_error"),
      });
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <AlertModalCore
        isOpen={modal === "revoke"}
        handleClose={closeModal}
        handleSubmit={() => void handleRevoke()}
        isSubmitting={isSubmitting}
        title={t("calendar_feed.revoke_modal.title")}
        content={t("calendar_feed.revoke_modal.description")}
        primaryButtonText={{
          default: t("calendar_feed.revoke_modal.confirm"),
          loading: t("calendar_feed.revoke_modal.confirming"),
        }}
        secondaryButtonText={t("cancel")}
      />
      <AlertModalCore
        isOpen={modal === "regenerate"}
        variant="primary"
        handleClose={closeModal}
        handleSubmit={() => void handleRegenerate()}
        isSubmitting={isSubmitting}
        title={t("calendar_feed.regenerate_modal.title")}
        content={t("calendar_feed.regenerate_modal.description")}
        primaryButtonText={{
          default: t("calendar_feed.regenerate_modal.confirm"),
          loading: t("calendar_feed.regenerate_modal.confirming"),
        }}
        secondaryButtonText={t("cancel")}
      />
      <div className="flex flex-col gap-2 border-b border-subtle py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {showScope && (
              <span className="truncate text-13 font-medium text-primary">
                {scopeLabel} · {feed.workspace_name}
              </span>
            )}
            <span className="font-mono rounded-xs bg-layer-1 px-1.5 text-11 text-tertiary">{feed.token_prefix}…</span>
            {feed.hide_completed && (
              <span className="rounded-xs bg-layer-1 px-1.5 text-11 text-tertiary">
                {t("calendar_feed.list.without_completed")}
              </span>
            )}
          </div>
          <p className="mt-1 text-12 text-tertiary">
            {t("calendar_feed.list.created_at", { date: renderFormattedDate(feed.created_at) ?? "" })}
            {" · "}
            {feed.last_used_at
              ? t("calendar_feed.list.last_used", { time: calculateTimeAgo(feed.last_used_at) })
              : t("calendar_feed.list.never_used")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" onClick={() => setModal("regenerate")}>
            {t("calendar_feed.actions.regenerate")}
          </Button>
          <Button variant="error-outline" onClick={() => setModal("revoke")}>
            {t("calendar_feed.actions.revoke")}
          </Button>
        </div>
      </div>
    </>
  );
});
