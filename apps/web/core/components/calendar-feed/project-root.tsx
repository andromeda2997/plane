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
// local imports
import { CalendarFeedCreateForm } from "./create-form";
import { CalendarFeedCreatedModal, CalendarFeedInstructions } from "./created-modal";
import { CalendarFeedList } from "./list";
// hooks
import { useCalendarFeed } from "@/hooks/store/use-calendar-feed";

type Props = {
  workspaceSlug: string;
  projectId: string;
};

/** Projekt-Einstellungen → Kalender abonnieren */
export const ProjectCalendarFeedsRoot = observer(function ProjectCalendarFeedsRoot(props: Props) {
  const { workspaceSlug, projectId } = props;
  const { t } = useTranslation();
  const { fetchProjectFeeds, getProjectFeeds, isLoading } = useCalendarFeed();
  // Klartext-URL nur im Komponenten-Zustand
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);

  useSWR(
    workspaceSlug && projectId ? `EXT_CALENDAR_FEEDS_${workspaceSlug}_${projectId}` : null,
    () => fetchProjectFeeds(workspaceSlug, projectId),
    { revalidateOnFocus: false }
  );

  const feeds = getProjectFeeds(projectId);

  return (
    <div className="flex flex-col gap-6">
      <CalendarFeedCreatedModal url={createdUrl} onClose={() => setCreatedUrl(null)} />
      <p className="text-13 text-tertiary">{t("calendar_feed.privacy_note")}</p>
      <CalendarFeedCreateForm
        workspaceSlug={workspaceSlug}
        payload={{ scope: "project", project_id: projectId }}
        onCreated={(feed) => setCreatedUrl(feed.url)}
      />
      <CalendarFeedList feeds={feeds} isLoading={isLoading} onRegenerated={(feed) => setCreatedUrl(feed.url)} />
      <CalendarFeedInstructions />
    </div>
  );
});
