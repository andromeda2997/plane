/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { History, Pause, Play, Repeat, Zap } from "lucide-react";
import { observer } from "mobx-react";
import useSWR from "swr";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { EmptyStateCompact } from "@plane/propel/empty-state";
import { EditIcon, TrashIcon } from "@plane/propel/icons";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TRecurringWorkItem, TRecurringWorkItemRunResponse } from "@plane/types";
import { AlertModalCore, CustomMenu, Loader } from "@plane/ui";
import { cn } from "@plane/utils";
// components
import { SettingsHeading } from "@/components/settings/heading";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useRecurringWorkItem } from "@/hooks/store/use-recurring-work-item";
// local imports
import { I18N_PREFIX, formatLocalDate, getRuleSummary } from "./helpers";
import { CreateUpdateRecurringWorkItemModal } from "./modal";
import { RecurringWorkItemRunsModal } from "./runs-modal";

type Props = {
  workspaceSlug: string;
  projectId: string;
  isEditable: boolean;
};

export const RecurringWorkItemsRoot = observer(function RecurringWorkItemsRoot(props: Props) {
  const { workspaceSlug, projectId, isEditable } = props;
  // states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [itemToEdit, setItemToEdit] = useState<TRecurringWorkItem | undefined>(undefined);
  const [itemToDelete, setItemToDelete] = useState<TRecurringWorkItem | null>(null);
  const [itemForHistory, setItemForHistory] = useState<TRecurringWorkItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // plane hooks
  const { t, currentLocale } = useTranslation();
  // store hooks
  const {
    getProjectRecurringWorkItems,
    fetchRecurringWorkItems,
    deleteRecurringWorkItem,
    pauseRecurringWorkItem,
    resumeRecurringWorkItem,
    runRecurringWorkItemNow,
  } = useRecurringWorkItem();
  const { getProjectIdentifierById } = useProject();
  // derived values
  const items = getProjectRecurringWorkItems(projectId);
  const projectIdentifier = getProjectIdentifierById(projectId);

  useSWR(
    workspaceSlug && projectId ? `RECURRING_WORK_ITEMS_${projectId}` : null,
    workspaceSlug && projectId ? () => fetchRecurringWorkItems(workspaceSlug, projectId) : null,
    { revalidateOnFocus: false }
  );

  const showError = (message?: string) =>
    setToast({ type: TOAST_TYPE.ERROR, title: t("error"), message: message ?? t(`${I18N_PREFIX}.toast.error`) });

  const openCreate = () => {
    setItemToEdit(undefined);
    setIsModalOpen(true);
  };

  const handleToggleActive = async (item: TRecurringWorkItem) => {
    setBusyId(item.id);
    try {
      if (item.is_active) await pauseRecurringWorkItem(workspaceSlug, projectId, item.id);
      else await resumeRecurringWorkItem(workspaceSlug, projectId, item.id);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("success"),
        message: t(`${I18N_PREFIX}.toast.${item.is_active ? "paused" : "resumed"}`),
      });
    } catch {
      showError();
    } finally {
      setBusyId(null);
    }
  };

  const handleRunNow = async (item: TRecurringWorkItem) => {
    setBusyId(item.id);
    try {
      const response = await runRecurringWorkItemNow(workspaceSlug, projectId, item.id);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("success"),
        message: t(`${I18N_PREFIX}.toast.run_success`, {
          identifier: `${projectIdentifier ?? ""}-${response.run.issue_sequence_id ?? ""}`,
        }),
      });
    } catch (error) {
      const run = (error as Partial<TRecurringWorkItemRunResponse> | undefined)?.run;
      showError(run?.error ? t(`${I18N_PREFIX}.toast.run_failed`, { error: run.error }) : undefined);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async () => {
    if (!itemToDelete) return;
    setIsDeleting(true);
    try {
      await deleteRecurringWorkItem(workspaceSlug, projectId, itemToDelete.id);
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("success"), message: t(`${I18N_PREFIX}.toast.deleted`) });
      setItemToDelete(null);
    } catch {
      showError();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <CreateUpdateRecurringWorkItemModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setItemToEdit(undefined);
        }}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        data={itemToEdit}
      />
      <RecurringWorkItemRunsModal
        isOpen={!!itemForHistory}
        onClose={() => setItemForHistory(null)}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        item={itemForHistory}
      />
      <AlertModalCore
        isOpen={!!itemToDelete}
        handleClose={() => !isDeleting && setItemToDelete(null)}
        handleSubmit={() => void handleDelete()}
        isSubmitting={isDeleting}
        title={t(`${I18N_PREFIX}.delete.title`)}
        content={t(`${I18N_PREFIX}.delete.content`, { name: itemToDelete?.name ?? "" })}
      />

      <SettingsHeading
        title={t(`${I18N_PREFIX}.heading`)}
        description={t(`${I18N_PREFIX}.description`)}
        control={
          isEditable && (
            <Button variant="primary" size="lg" onClick={openCreate}>
              {t(`${I18N_PREFIX}.add`)}
            </Button>
          )
        }
      />

      <div className="mt-6 w-full">
        {!items ? (
          <Loader className="space-y-3">
            <Loader.Item height="56px" />
            <Loader.Item height="56px" />
          </Loader>
        ) : items.length === 0 ? (
          <EmptyStateCompact
            assetKey="work-item"
            assetClassName="size-20"
            title={t(`${I18N_PREFIX}.empty_title`)}
            description={t(`${I18N_PREFIX}.empty_description`)}
            actions={isEditable ? [{ label: t(`${I18N_PREFIX}.add`), onClick: openCreate }] : []}
            align="start"
            rootClassName="py-20"
          />
        ) : (
          <div className="divide-y divide-subtle rounded-md border border-subtle">
            {items.map((item) => (
              <div
                key={item.id}
                className={cn("flex items-center gap-3 px-4 py-3", { "opacity-60": busyId === item.id })}
              >
                <Repeat
                  className={cn("size-4 shrink-0", item.is_active ? "text-accent-primary" : "text-placeholder")}
                />
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="max-w-full truncate text-left text-body-sm-medium text-primary hover:underline disabled:no-underline"
                    onClick={() => {
                      setItemToEdit(item);
                      setIsModalOpen(true);
                    }}
                    disabled={!isEditable}
                  >
                    {item.name}
                  </button>
                  <div className="truncate text-caption-md-regular text-tertiary">
                    {getRuleSummary(t, item, currentLocale)}
                  </div>
                </div>
                <div className="hidden shrink-0 flex-col items-end text-caption-md-regular sm:flex">
                  {!item.is_active ? (
                    <span className="rounded-sm bg-layer-3 px-1.5 py-0.5 text-secondary">
                      {t(`${I18N_PREFIX}.paused`)}
                    </span>
                  ) : item.next_occurrence_date ? (
                    <span className="text-secondary">
                      {t(`${I18N_PREFIX}.next_run`, {
                        date: formatLocalDate(item.next_occurrence_date, currentLocale),
                      })}
                    </span>
                  ) : (
                    <span className="text-placeholder">{t(`${I18N_PREFIX}.no_next_run`)}</span>
                  )}
                  <span className="text-placeholder">
                    {t(`${I18N_PREFIX}.created_count`, { count: item.occurrence_count })}
                  </span>
                </div>
                <CustomMenu ellipsis placement="bottom-end" closeOnSelect disabled={busyId === item.id}>
                  {isEditable && (
                    <CustomMenu.MenuItem
                      onClick={() => {
                        setItemToEdit(item);
                        setIsModalOpen(true);
                      }}
                      className="flex items-center gap-2"
                    >
                      <EditIcon className="size-3" />
                      {t(`${I18N_PREFIX}.actions.edit`)}
                    </CustomMenu.MenuItem>
                  )}
                  {isEditable && (
                    <CustomMenu.MenuItem onClick={() => void handleRunNow(item)} className="flex items-center gap-2">
                      <Zap className="size-3" />
                      {t(`${I18N_PREFIX}.actions.run_now`)}
                    </CustomMenu.MenuItem>
                  )}
                  {isEditable && (
                    <CustomMenu.MenuItem
                      onClick={() => void handleToggleActive(item)}
                      className="flex items-center gap-2"
                    >
                      {item.is_active ? <Pause className="size-3" /> : <Play className="size-3" />}
                      {t(`${I18N_PREFIX}.actions.${item.is_active ? "pause" : "resume"}`)}
                    </CustomMenu.MenuItem>
                  )}
                  <CustomMenu.MenuItem onClick={() => setItemForHistory(item)} className="flex items-center gap-2">
                    <History className="size-3" />
                    {t(`${I18N_PREFIX}.actions.history`)}
                  </CustomMenu.MenuItem>
                  {isEditable && (
                    <CustomMenu.MenuItem
                      onClick={() => setItemToDelete(item)}
                      className="flex items-center gap-2 text-danger-primary"
                    >
                      <TrashIcon className="size-3" />
                      {t(`${I18N_PREFIX}.actions.delete`)}
                    </CustomMenu.MenuItem>
                  )}
                </CustomMenu>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
});
