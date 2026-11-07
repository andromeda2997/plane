/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { AlertTriangle, Pencil, Trash2 } from "lucide-react";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TMilestone } from "@plane/types";
import { Loader } from "@plane/ui";
import { renderFormattedDate } from "@plane/utils";
// hooks
import { useMilestone } from "@/hooks/store/use-milestone";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { getMilestoneDisplayColor, getMilestoneProgress, getTodayPayloadDate, isMilestoneOverdue } from "./helpers";
import type { TMilestoneModalState } from "./modal";
import { MilestoneDeleteModal, MilestoneModal } from "./modal";
import { MilestoneProgressBar } from "./progress-bar";

type Props = {
  workspaceSlug: string;
  projectId: string;
};

/** Verwaltung der Meilensteine in den Projekt-Einstellungen. */
export const ProjectMilestonesRoot = observer(function ProjectMilestonesRoot(props: Props) {
  const { workspaceSlug, projectId } = props;
  const { t } = useTranslation();
  // states
  const [modalState, setModalState] = useState<TMilestoneModalState | null>(null);
  // store hooks
  const { fetchedProjects, getProjectMilestones, fetchProjectMilestones } = useMilestone();
  const { allowPermissions } = useUserPermissions();
  // derived values
  const canEdit = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug,
    projectId
  );
  const milestones = getProjectMilestones(projectId);

  useEffect(() => {
    void fetchProjectMilestones(workspaceSlug, projectId).catch(() =>
      setToast({ type: TOAST_TYPE.ERROR, title: `${t("error")}!`, message: t("milestone.toast.load_error") })
    );
  }, [fetchProjectMilestones, workspaceSlug, projectId, t]);

  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <div className="flex justify-end">
          <Button variant="primary" onClick={() => setModalState({ date: getTodayPayloadDate() })}>
            {t("milestone.create")}
          </Button>
        </div>
      )}
      {!fetchedProjects[projectId] ? (
        <Loader className="space-y-3">
          <Loader.Item height="56px" />
          <Loader.Item height="56px" />
        </Loader>
      ) : milestones.length === 0 ? (
        <div className="rounded-md border-[0.5px] border-subtle bg-layer-1 px-4 py-6 text-center">
          <p className="text-13 font-medium text-primary">{t("milestone.empty_title")}</p>
          <p className="mt-1 text-12 text-tertiary">{t("milestone.empty_description")}</p>
        </div>
      ) : (
        <div className="flex flex-col">
          {milestones.map((milestone) => (
            <MilestoneListItem
              key={milestone.id}
              workspaceSlug={workspaceSlug}
              projectId={projectId}
              milestone={milestone}
              canEdit={canEdit}
              onEdit={() => setModalState({ milestoneId: milestone.id })}
            />
          ))}
        </div>
      )}
      <MilestoneModal
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        state={modalState}
        onClose={() => setModalState(null)}
      />
    </div>
  );
});

type ItemProps = {
  workspaceSlug: string;
  projectId: string;
  milestone: TMilestone;
  canEdit: boolean;
  onEdit: () => void;
};

const MilestoneListItem = observer(function MilestoneListItem(props: ItemProps) {
  const { workspaceSlug, projectId, milestone, canEdit, onEdit } = props;
  const { t } = useTranslation();
  const { deleteMilestone } = useMilestone();
  // states
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  // derived values
  const progress = getMilestoneProgress(milestone);
  const overdue = isMilestoneOverdue(milestone);
  const color = getMilestoneDisplayColor(milestone);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteMilestone(workspaceSlug, projectId, milestone.id);
      setToast({ type: TOAST_TYPE.SUCCESS, title: `${t("success")}!`, message: t("milestone.toast.deleted") });
      setIsDeleteOpen(false);
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: `${t("error")}!`, message: t("milestone.toast.delete_error") });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <MilestoneDeleteModal
        isOpen={isDeleteOpen}
        name={milestone.name}
        isSubmitting={isDeleting}
        onClose={() => setIsDeleteOpen(false)}
        onConfirm={() => void handleDelete()}
      />
      <div className="flex flex-col gap-2 border-b border-subtle py-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-1 size-3 flex-shrink-0 rounded-full" style={{ backgroundColor: milestone.color }} />
          <div className="min-w-0">
            <p className="truncate text-13 font-medium text-primary">{milestone.name}</p>
            <p className="flex items-center gap-1 text-12 text-tertiary">
              {renderFormattedDate(milestone.date)}
              {overdue && (
                <span className="flex items-center gap-1 text-danger-primary">
                  <AlertTriangle className="size-3" />
                  {t("milestone.overdue", { count: progress.open })}
                </span>
              )}
            </p>
            {milestone.description && (
              <p className="mt-0.5 line-clamp-2 text-12 whitespace-pre-line text-tertiary">{milestone.description}</p>
            )}
          </div>
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-48">
          <span className="text-11 text-tertiary">
            {progress.total > 0
              ? t("milestone.progress", { done: progress.done, total: progress.total })
              : t("milestone.progress_none")}
          </span>
          <MilestoneProgressBar progress={progress} color={color} />
        </div>
        {canEdit && (
          <div className="flex flex-shrink-0 items-center gap-1">
            <Button variant="secondary" size="sm" onClick={onEdit} prependIcon={<Pencil className="size-3" />}>
              {t("milestone.edit_short")}
            </Button>
            <Button
              variant="error-outline"
              size="sm"
              onClick={() => setIsDeleteOpen(true)}
              aria-label={t("milestone.delete")}
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
        )}
      </div>
    </>
  );
});
