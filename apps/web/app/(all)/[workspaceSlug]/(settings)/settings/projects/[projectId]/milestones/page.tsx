/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
// components
import { PageHead } from "@/components/core/page-title";
import { ProjectMilestonesRoot } from "@/components/milestones/settings";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { SettingsHeading } from "@/components/settings/heading";
// hooks
import { useProject } from "@/hooks/store/use-project";
// local imports
import type { Route } from "./+types/page";
import { MilestonesProjectSettingsHeader } from "./header";

function MilestonesSettingsPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, projectId } = params;
  const { t } = useTranslation();
  const { currentProjectDetails } = useProject();
  // derived values
  const pageTitle = currentProjectDetails?.name
    ? `${currentProjectDetails.name} - ${t("common.milestones")}`
    : undefined;

  // Alle Projektrollen dürfen lesen; Anlegen/Bearbeiten/Löschen nur Admin/Mitglied (siehe Root).
  return (
    <SettingsContentWrapper header={<MilestonesProjectSettingsHeader />}>
      <PageHead title={pageTitle} />
      <div className="flex flex-col gap-6">
        <SettingsHeading title={t("common.milestones")} description={t("milestone.settings_description")} />
        <ProjectMilestonesRoot workspaceSlug={workspaceSlug} projectId={projectId} />
      </div>
    </SettingsContentWrapper>
  );
}

export default observer(MilestonesSettingsPage);
