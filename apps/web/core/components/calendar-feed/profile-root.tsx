/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
// plane imports
import { useTranslation } from "@plane/i18n";
import { CustomSelect } from "@plane/ui";
// hooks
import { useCalendarFeed } from "@/hooks/store/use-calendar-feed";
import { useWorkspace } from "@/hooks/store/use-workspace";
// local imports
import { CalendarFeedCreateForm } from "./create-form";
import { CalendarFeedCreatedModal, CalendarFeedInstructions } from "./created-modal";
import { CalendarFeedList } from "./list";

/** Profil-Einstellungen → Kalender abonnieren („Meine Arbeitselemente“ + alle eigenen Feeds) */
export const ProfileCalendarFeedsRoot = observer(function ProfileCalendarFeedsRoot() {
  const { t } = useTranslation();
  const { workspaces, currentWorkspace } = useWorkspace();
  const { fetchMyFeeds, allFeeds, isLoading } = useCalendarFeed();
  // states
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  // Klartext-URL nur im Komponenten-Zustand
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);

  useSWR("EXT_CALENDAR_FEEDS_ME", () => fetchMyFeeds(), { revalidateOnFocus: false });

  const workspaceList = Object.values(workspaces ?? {});
  const workspaceSlug = selectedSlug ?? currentWorkspace?.slug ?? workspaceList[0]?.slug ?? null;
  const selectedWorkspace = workspaceList.find((workspace) => workspace.slug === workspaceSlug);

  return (
    <div className="flex flex-col gap-6">
      <CalendarFeedCreatedModal url={createdUrl} onClose={() => setCreatedUrl(null)} />
      <p className="text-13 text-tertiary">{t("calendar_feed.privacy_note")}</p>
      <CalendarFeedCreateForm
        workspaceSlug={workspaceSlug}
        payload={{ scope: "my_work_items" }}
        onCreated={(feed) => setCreatedUrl(feed.url)}
      >
        <div className="flex items-center justify-between gap-4 text-13 text-secondary">
          <span>{t("calendar_feed.workspace_label")}</span>
          <CustomSelect
            value={workspaceSlug}
            onChange={(value: string) => setSelectedSlug(value)}
            label={selectedWorkspace?.name ?? "—"}
            buttonClassName="py-1.5 text-13"
            placement="bottom-end"
          >
            {workspaceList.map((workspace) => (
              <CustomSelect.Option key={workspace.id} value={workspace.slug}>
                <span className="truncate">{workspace.name}</span>
              </CustomSelect.Option>
            ))}
          </CustomSelect>
        </div>
      </CalendarFeedCreateForm>
      <CalendarFeedList
        feeds={allFeeds}
        isLoading={isLoading}
        showScope
        onRegenerated={(feed) => setCreatedUrl(feed.url)}
      />
      <CalendarFeedInstructions />
    </div>
  );
});
