/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
// components
import { ProjectCalendarFeedsRoot } from "@/components/calendar-feed";
import { PageHead } from "@/components/core/page-title";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { SettingsHeading } from "@/components/settings/heading";
// hooks
import { useProject } from "@/hooks/store/use-project";
// local imports
import type { Route } from "./+types/page";
import { CalendarFeedProjectSettingsHeader } from "./header";

function CalendarFeedSettingsPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, projectId } = params;
  const { t } = useTranslation();
  const { currentProjectDetails } = useProject();
  // derived values
  const pageTitle = currentProjectDetails?.name
    ? `${currentProjectDetails.name} - ${t("calendar_feed.settings_label")}`
    : undefined;

  // Alle Projektrollen (auch Gäste) dürfen eigene Kalender-Links anlegen; die
  // Sichtbarkeit im Feed prüft das Backend bei jedem Abruf.
  return (
    <SettingsContentWrapper header={<CalendarFeedProjectSettingsHeader />}>
      <PageHead title={pageTitle} />
      <div className="flex flex-col gap-6">
        <SettingsHeading title={t("calendar_feed.title")} description={t("calendar_feed.project_description")} />
        <ProjectCalendarFeedsRoot workspaceSlug={workspaceSlug} projectId={projectId} />
      </div>
    </SettingsContentWrapper>
  );
}

export default observer(CalendarFeedSettingsPage);
