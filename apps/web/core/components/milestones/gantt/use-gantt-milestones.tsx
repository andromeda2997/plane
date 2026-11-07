/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { Flag } from "lucide-react";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
// hooks
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { getTodayPayloadDate } from "../helpers";
import type { TMilestoneModalState } from "../modal";
import { MilestoneModal } from "../modal";
import { GanttMilestonesLayer } from "./layer";

type Params = {
  workspaceSlug: string | undefined;
  projectId: string | undefined;
  /** false → keine Meilensteine (z. B. Epics, projektübergreifende Diagramme) */
  enabled: boolean;
};

/**
 * Liefert die Bausteine für Meilensteine im Arbeitselement-Gantt eines Projekts:
 * Ebene für das Diagramm, Schaltfläche für den Kopf und das Bearbeiten-Modal.
 */
export const useGanttMilestones = ({ workspaceSlug, projectId, enabled }: Params) => {
  const { t } = useTranslation();
  const { allowPermissions } = useUserPermissions();
  const [modalState, setModalState] = useState<TMilestoneModalState | null>(null);

  if (!enabled || !workspaceSlug || !projectId)
    return { chartOverlay: undefined, headerActions: undefined, modal: null };

  const canEdit = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug,
    projectId
  );

  return {
    chartOverlay: (
      <GanttMilestonesLayer
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        canEdit={canEdit}
        onOpenModal={setModalState}
      />
    ),
    headerActions: canEdit ? (
      <button
        type="button"
        className="flex items-center gap-1 rounded-md bg-layer-transparent p-1 px-2 text-11 hover:bg-layer-transparent-hover"
        onClick={() => setModalState({ date: getTodayPayloadDate() })}
      >
        <Flag className="size-3" />
        {t("milestone.add")}
      </button>
    ) : undefined,
    modal: (
      <MilestoneModal
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        state={modalState}
        onClose={() => setModalState(null)}
      />
    ),
  };
};
