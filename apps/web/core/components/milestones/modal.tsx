/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Controller, useForm } from "react-hook-form";
import { Check } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TMilestone, TMilestoneFormData } from "@plane/types";
import { AlertModalCore, EModalPosition, EModalWidth, Input, ModalCore, TextArea } from "@plane/ui";
import { cn, getDate, renderFormattedPayloadDate } from "@plane/utils";
// components
import { DateDropdown } from "@/components/dropdowns/date";
// hooks
import { useMilestone } from "@/hooks/store/use-milestone";
// local imports
import {
  DEFAULT_MILESTONE_COLOR,
  getMilestoneProgress,
  HEX_COLOR_REGEX,
  MILESTONE_COLORS,
  MILESTONE_DESCRIPTION_MAX_LENGTH,
} from "./helpers";
import { MilestoneProgressBar } from "./progress-bar";

export type TMilestoneModalState = {
  /** bearbeiten, wenn gesetzt – sonst neu anlegen */
  milestoneId?: string;
  /** vorbelegtes Datum beim Anlegen (YYYY-MM-DD) */
  date?: string;
};

type Props = {
  workspaceSlug: string;
  projectId: string;
  state: TMilestoneModalState | null;
  onClose: () => void;
};

const defaultValues = (milestone: TMilestone | undefined, date: string | undefined): TMilestoneFormData => ({
  name: milestone?.name ?? "",
  date: milestone?.date ?? date ?? renderFormattedPayloadDate(new Date()) ?? "",
  color: milestone?.color ?? DEFAULT_MILESTONE_COLOR,
  description: milestone?.description ?? "",
});

export const MilestoneModal = observer(function MilestoneModal(props: Props) {
  const { workspaceSlug, projectId, state, onClose } = props;
  const { t } = useTranslation();
  const { getMilestoneById, createMilestone, updateMilestone, deleteMilestone } = useMilestone();
  // states
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  // derived values
  const milestone = state?.milestoneId ? getMilestoneById(state.milestoneId) : undefined;
  const isEdit = !!milestone;
  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    reset,
    watch,
    setValue,
  } = useForm<TMilestoneFormData>({ defaultValues: defaultValues(milestone, state?.date) });

  useEffect(() => {
    if (state) reset(defaultValues(milestone, state.date));
    // nur beim Öffnen neu befüllen, nicht bei jeder Änderung des Meilensteins
    // oxlint-disable-next-line eslint-plugin-react-hooks/exhaustive-deps
  }, [state]);

  const selectedColor = watch("color");

  const handleClose = () => {
    setIsDeleteOpen(false);
    onClose();
  };

  const onSubmit = async (data: TMilestoneFormData) => {
    const payload: TMilestoneFormData = {
      ...data,
      name: data.name.trim(),
      description: data.description.trim(),
      color: data.color.toUpperCase(),
    };
    try {
      if (milestone) await updateMilestone(workspaceSlug, projectId, milestone.id, payload);
      else await createMilestone(workspaceSlug, projectId, payload);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: `${t("success")}!`,
        message: t(isEdit ? "milestone.toast.updated" : "milestone.toast.created"),
      });
      handleClose();
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: `${t("error")}!`, message: t("milestone.toast.error") });
    }
  };

  const handleDelete = async () => {
    if (!milestone) return;
    setIsDeleting(true);
    try {
      await deleteMilestone(workspaceSlug, projectId, milestone.id);
      setToast({ type: TOAST_TYPE.SUCCESS, title: `${t("success")}!`, message: t("milestone.toast.deleted") });
      handleClose();
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: `${t("error")}!`, message: t("milestone.toast.delete_error") });
    } finally {
      setIsDeleting(false);
    }
  };

  const progress = milestone ? getMilestoneProgress(milestone) : undefined;

  return (
    <>
      <ModalCore
        isOpen={!!state && !isDeleteOpen}
        handleClose={handleClose}
        position={EModalPosition.TOP}
        width={EModalWidth.XXL}
      >
        <form onSubmit={(event) => void handleSubmit(onSubmit)(event)}>
          <div className="space-y-4 p-5">
            <h3 className="text-18 font-medium text-secondary">{t(isEdit ? "milestone.edit" : "milestone.create")}</h3>
            <div className="space-y-1">
              <label htmlFor="milestone-name" className="text-13 text-secondary">
                {t("milestone.form.name")}
              </label>
              <Controller
                control={control}
                name="name"
                rules={{
                  validate: (value) => value.trim().length > 0 || t("milestone.form.name_required"),
                  maxLength: { value: 255, message: t("milestone.form.name_too_long") },
                }}
                render={({ field: { value, onChange, ref } }) => (
                  <Input
                    id="milestone-name"
                    name="name"
                    type="text"
                    value={value}
                    onChange={onChange}
                    ref={ref}
                    hasError={Boolean(errors?.name)}
                    placeholder={t("milestone.form.name_placeholder")}
                    className="w-full text-14"
                  />
                )}
              />
              {errors?.name?.message && <span className="text-11 text-danger-primary">{errors.name.message}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="space-y-1">
                <span className="block text-13 text-secondary">{t("milestone.form.date")}</span>
                <Controller
                  control={control}
                  name="date"
                  rules={{ required: t("milestone.form.date_required") }}
                  render={({ field: { value, onChange } }) => (
                    <div className="h-7">
                      <DateDropdown
                        value={getDate(value) ?? null}
                        onChange={(date) => onChange(date ? (renderFormattedPayloadDate(date) ?? "") : "")}
                        buttonVariant="border-with-text"
                        placeholder={t("milestone.form.date")}
                        isClearable={false}
                      />
                    </div>
                  )}
                />
              </div>
              <div className="space-y-1">
                <span className="block text-13 text-secondary">{t("milestone.form.color")}</span>
                <div className="flex items-center gap-1.5">
                  {MILESTONE_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={cn(
                        "grid size-6 place-items-center rounded-full border border-transparent outline-none focus-visible:ring-2",
                        { "border-strong": selectedColor?.toUpperCase() === color }
                      )}
                      style={{ backgroundColor: color }}
                      onClick={() => setValue("color", color, { shouldDirty: true })}
                      aria-label={color}
                      aria-pressed={selectedColor?.toUpperCase() === color}
                    >
                      {selectedColor?.toUpperCase() === color && <Check className="size-3.5 text-white" />}
                    </button>
                  ))}
                  <Controller
                    control={control}
                    name="color"
                    rules={{ pattern: { value: HEX_COLOR_REGEX, message: t("milestone.form.color_invalid") } }}
                    render={({ field: { value, onChange } }) => (
                      <input
                        type="color"
                        value={HEX_COLOR_REGEX.test(value) ? value : DEFAULT_MILESTONE_COLOR}
                        onChange={(event) => onChange(event.target.value.toUpperCase())}
                        className="size-6 cursor-pointer rounded-sm border border-subtle bg-transparent p-0"
                        title={t("milestone.form.custom_color")}
                        aria-label={t("milestone.form.custom_color")}
                      />
                    )}
                  />
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor="milestone-description" className="text-13 text-secondary">
                {t("milestone.form.description")}
              </label>
              <Controller
                control={control}
                name="description"
                rules={{
                  maxLength: { value: MILESTONE_DESCRIPTION_MAX_LENGTH, message: t("milestone.form.too_long") },
                }}
                render={({ field: { value, onChange } }) => (
                  <TextArea
                    id="milestone-description"
                    name="description"
                    value={value}
                    onChange={onChange}
                    placeholder={t("milestone.form.description_placeholder")}
                    maxLength={MILESTONE_DESCRIPTION_MAX_LENGTH}
                    className="min-h-20 w-full resize-none text-14"
                    hasError={Boolean(errors?.description)}
                  />
                )}
              />
            </div>
            {milestone && progress && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-12 text-tertiary">
                  <span>{t("milestone.progress_label")}</span>
                  <span>
                    {progress.total > 0
                      ? t("milestone.progress", { done: progress.done, total: progress.total })
                      : t("milestone.progress_none")}
                  </span>
                </div>
                <MilestoneProgressBar progress={progress} color={milestone.color} />
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 border-t-[0.5px] border-subtle px-5 py-4">
            <div>
              {milestone && (
                <Button variant="error-outline" size="lg" onClick={() => setIsDeleteOpen(true)}>
                  {t("milestone.delete")}
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="lg" onClick={handleClose}>
                {t("cancel")}
              </Button>
              <Button variant="primary" size="lg" type="submit" loading={isSubmitting}>
                {t(isEdit ? "milestone.save" : "milestone.create")}
              </Button>
            </div>
          </div>
        </form>
      </ModalCore>
      {milestone && (
        <MilestoneDeleteModal
          isOpen={isDeleteOpen}
          name={milestone.name}
          isSubmitting={isDeleting}
          onClose={() => setIsDeleteOpen(false)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </>
  );
});

type DeleteProps = {
  isOpen: boolean;
  name: string;
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function MilestoneDeleteModal(props: DeleteProps) {
  const { isOpen, name, isSubmitting, onClose, onConfirm } = props;
  const { t } = useTranslation();
  return (
    <AlertModalCore
      isOpen={isOpen}
      handleClose={onClose}
      handleSubmit={onConfirm}
      isSubmitting={isSubmitting}
      title={t("milestone.delete_modal.title")}
      content={t("milestone.delete_modal.description", { name })}
      primaryButtonText={{ default: t("milestone.delete"), loading: t("milestone.delete_modal.deleting") }}
      secondaryButtonText={t("cancel")}
    />
  );
}
