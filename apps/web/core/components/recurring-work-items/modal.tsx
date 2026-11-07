/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { sortBy } from "lodash-es";
import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type {
  TRecurringWorkItem,
  TRecurringWorkItemEndType,
  TRecurringWorkItemFormData,
  TRecurringWorkItemFrequency,
  TRecurringWorkItemWeekday,
} from "@plane/types";
import { CustomSelect, EModalPosition, EModalWidth, Input, ModalCore, ToggleSwitch } from "@plane/ui";
import { cn, renderFormattedPayloadDate } from "@plane/utils";
// components
import { CycleDropdown } from "@/components/dropdowns/cycle";
import { DateDropdown } from "@/components/dropdowns/date";
import { MemberDropdown } from "@/components/dropdowns/member/dropdown";
import { ModuleDropdown } from "@/components/dropdowns/module/dropdown";
import { PriorityDropdown } from "@/components/dropdowns/priority";
import { StateDropdown } from "@/components/dropdowns/state/dropdown";
import { RichTextEditor } from "@/components/editor/rich-text/editor";
import { IssueLabelSelect } from "@/components/issues/select";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useRecurringWorkItem } from "@/hooks/store/use-recurring-work-item";
import { useWorkspace } from "@/hooks/store/use-workspace";
// services
import { WorkspaceService } from "@/services/workspace.service";
// local imports
import type { TFormErrors } from "./helpers";
import {
  I18N_PREFIX,
  WEEKDAYS,
  getDefaultFormData,
  getRuleSummary,
  recurringWorkItemToFormData,
  toPayload,
  validateFormData,
} from "./helpers";

const workspaceService = new WorkspaceService();

const FREQUENCIES: TRecurringWorkItemFrequency[] = ["daily", "weekly", "monthly"];
const END_TYPES: TRecurringWorkItemEndType[] = ["never", "on_date", "after_count"];

type Props = {
  isOpen: boolean;
  onClose: () => void;
  workspaceSlug: string;
  projectId: string;
  /** existing entry to edit */
  data?: TRecurringWorkItem;
  /** prefill values for a new entry, e.g. from a work item */
  initialValues?: Partial<TRecurringWorkItemFormData>;
  onSuccess?: (item: TRecurringWorkItem) => void;
};

const parseNumber = (value: string): number | null => {
  if (value.trim() === "") return null;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-caption-md-medium text-tertiary">{children}</div>;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-caption-md-regular text-danger-primary">{message}</p>;
}

export const CreateUpdateRecurringWorkItemModal = observer(function CreateUpdateRecurringWorkItemModal(props: Props) {
  const { isOpen, onClose, workspaceSlug, projectId, data, initialValues, onSuccess } = props;
  // states
  const [formData, setFormData] = useState<TRecurringWorkItemFormData>(getDefaultFormData());
  const [errors, setErrors] = useState<TFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  // plane hooks
  const { t, currentLocale } = useTranslation();
  // store hooks
  const { createRecurringWorkItem, updateRecurringWorkItem } = useRecurringWorkItem();
  const { getProjectById } = useProject();
  const { getWorkspaceBySlug } = useWorkspace();
  // derived values
  const projectDetails = getProjectById(projectId);
  const workspaceId = getWorkspaceBySlug(workspaceSlug)?.id ?? "";
  const isEditing = !!data;

  useEffect(() => {
    if (!isOpen) return;
    setFormData(data ? recurringWorkItemToFormData(data) : { ...getDefaultFormData(), ...initialValues });
    setErrors({});
    setEditorKey((key) => key + 1);
    // oxlint-disable-next-line eslint-plugin-react-hooks/exhaustive-deps
  }, [isOpen, data?.id]);

  const handleChange = <K extends keyof TRecurringWorkItemFormData>(key: K, value: TRecurringWorkItemFormData[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const toggleWeekday = (day: TRecurringWorkItemWeekday) => {
    const weekdays = formData.weekdays.includes(day)
      ? formData.weekdays.filter((d) => d !== day)
      : sortBy([...formData.weekdays, day]);
    handleChange("weekdays", weekdays);
  };

  const handleClose = () => {
    if (isSubmitting) return;
    onClose();
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const validationErrors = validateFormData(t, formData);
    if (Object.values(validationErrors).some(Boolean)) {
      setErrors(validationErrors);
      return;
    }
    setIsSubmitting(true);
    try {
      const payload = toPayload(formData);
      const item =
        isEditing && data
          ? await updateRecurringWorkItem(workspaceSlug, projectId, data.id, payload)
          : await createRecurringWorkItem(workspaceSlug, projectId, payload);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("success"),
        message: t(`${I18N_PREFIX}.toast.${isEditing ? "updated" : "created"}`),
      });
      onSuccess?.(item);
      onClose();
    } catch (error) {
      const apiErrors = (error ?? {}) as Record<string, string[] | string>;
      const fieldErrors: TFormErrors = {};
      Object.entries(apiErrors).forEach(([key, value]) => {
        if (key in formData) fieldErrors[key as keyof TRecurringWorkItemFormData] = String(value);
      });
      setErrors(fieldErrors);
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("error"),
        message: Object.values(fieldErrors)[0] ?? t(`${I18N_PREFIX}.toast.error`),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const intervalUnit = t(`${I18N_PREFIX}.unit.${formData.frequency}`, { count: formData.interval || 1 });

  return (
    <ModalCore isOpen={isOpen} handleClose={handleClose} position={EModalPosition.TOP} width={EModalWidth.XXXL}>
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-5 p-5">
        <h3 className="text-h5-medium text-primary">
          {t(`${I18N_PREFIX}.${isEditing ? "edit_title" : "create_title"}`)}
        </h3>

        {/* Template */}
        <div>
          <FieldLabel>{t(`${I18N_PREFIX}.fields.name`)}</FieldLabel>
          <Input
            id="recurring-work-item-name"
            value={formData.name}
            onChange={(e) => handleChange("name", e.target.value)}
            placeholder={t(`${I18N_PREFIX}.fields.name_placeholder`)}
            hasError={!!errors.name}
            className="w-full"
          />
          <FieldError message={errors.name} />
        </div>
        <div>
          <FieldLabel>{t(`${I18N_PREFIX}.fields.description`)}</FieldLabel>
          <div className="rounded-md border border-subtle">
            {workspaceId && (
              <RichTextEditor
                key={editorKey}
                editable
                id={`recurring-work-item-editor-${data?.id ?? "new"}`}
                initialValue={formData.description_html || "<p></p>"}
                workspaceSlug={workspaceSlug}
                workspaceId={workspaceId}
                projectId={projectId}
                dragDropEnabled={false}
                disabledExtensions={["image"]}
                onChange={(_description: object, descriptionHtml: string) =>
                  handleChange("description_html", descriptionHtml)
                }
                searchMentionCallback={async (payload) =>
                  await workspaceService.searchEntity(workspaceSlug, { ...payload, project_id: projectId })
                }
                uploadFile={async () => {
                  throw new Error("Uploads are not supported in templates");
                }}
                duplicateFile={async () => {
                  throw new Error("Uploads are not supported in templates");
                }}
                containerClassName="min-h-[100px] max-h-[240px] overflow-y-auto pt-2"
              />
            )}
          </div>
        </div>

        <div>
          <FieldLabel>{t(`${I18N_PREFIX}.fields.properties`)}</FieldLabel>
          <div className="flex flex-wrap items-center gap-2">
            <div className="h-7">
              <StateDropdown
                value={formData.state_id}
                onChange={(stateId) => handleChange("state_id", stateId)}
                projectId={projectId}
                buttonVariant="border-with-text"
                isForWorkItemCreation
              />
            </div>
            <div className="h-7">
              <PriorityDropdown
                value={formData.priority}
                onChange={(priority) => handleChange("priority", priority)}
                buttonVariant="border-with-text"
              />
            </div>
            <div className="h-7">
              <MemberDropdown
                projectId={projectId}
                value={formData.assignee_ids}
                onChange={(assigneeIds) => handleChange("assignee_ids", assigneeIds)}
                buttonVariant={formData.assignee_ids.length > 0 ? "transparent-without-text" : "border-with-text"}
                buttonClassName={formData.assignee_ids.length > 0 ? "hover:bg-transparent" : ""}
                placeholder={t("assignees")}
                multiple
              />
            </div>
            <div className="h-7">
              <IssueLabelSelect
                value={formData.label_ids}
                onChange={(labelIds) => handleChange("label_ids", labelIds)}
                projectId={projectId}
              />
            </div>
            {projectDetails?.cycle_view && (
              <div className="h-7">
                <CycleDropdown
                  projectId={projectId}
                  value={formData.cycle_id}
                  onChange={(cycleId) => handleChange("cycle_id", cycleId)}
                  placeholder={t("cycle.label", { count: 1 })}
                  buttonVariant="border-with-text"
                />
              </div>
            )}
            {projectDetails?.module_view && (
              <div className="h-7">
                <ModuleDropdown
                  projectId={projectId}
                  value={formData.module_id}
                  onChange={(moduleId) => handleChange("module_id", moduleId)}
                  placeholder={t("modules")}
                  buttonVariant="border-with-text"
                  multiple={false}
                />
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel>{t(`${I18N_PREFIX}.fields.duration`)}</FieldLabel>
            <Input
              type="number"
              min={1}
              value={formData.duration_days ?? ""}
              onChange={(e) => handleChange("duration_days", parseNumber(e.target.value))}
              className="w-full"
            />
            <p className="mt-1 text-caption-md-regular text-placeholder">{t(`${I18N_PREFIX}.fields.duration_hint`)}</p>
          </div>
          <div>
            <FieldLabel>{t(`${I18N_PREFIX}.fields.create_days_before`)}</FieldLabel>
            <Input
              type="number"
              min={0}
              value={formData.create_days_before}
              onChange={(e) => handleChange("create_days_before", Math.max(parseNumber(e.target.value) ?? 0, 0))}
              className="w-full"
            />
            <p className="mt-1 text-caption-md-regular text-placeholder">
              {t(`${I18N_PREFIX}.fields.create_days_before_hint`)}
            </p>
          </div>
        </div>

        {/* Rule */}
        <div className="flex flex-col gap-4 rounded-md border border-subtle p-4">
          <div className="text-body-sm-medium text-primary">{t(`${I18N_PREFIX}.fields.rule`)}</div>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <FieldLabel>{t(`${I18N_PREFIX}.fields.frequency`)}</FieldLabel>
              <CustomSelect
                value={formData.frequency}
                onChange={(value: TRecurringWorkItemFrequency) => handleChange("frequency", value)}
                label={t(`${I18N_PREFIX}.frequency.${formData.frequency}`)}
                buttonClassName="min-w-32"
                input
              >
                {FREQUENCIES.map((frequency) => (
                  <CustomSelect.Option key={frequency} value={frequency}>
                    {t(`${I18N_PREFIX}.frequency.${frequency}`)}
                  </CustomSelect.Option>
                ))}
              </CustomSelect>
            </div>
            <div>
              <FieldLabel>{t(`${I18N_PREFIX}.fields.interval`)}</FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  value={formData.interval}
                  onChange={(e) => handleChange("interval", Math.max(parseNumber(e.target.value) ?? 1, 1))}
                  className="w-20"
                />
                <span className="text-body-xs-regular text-secondary">{intervalUnit}</span>
              </div>
            </div>
            {formData.frequency === "monthly" && (
              <div>
                <FieldLabel>{t(`${I18N_PREFIX}.fields.month_day`)}</FieldLabel>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={formData.month_day ?? ""}
                  onChange={(e) => handleChange("month_day", parseNumber(e.target.value))}
                  hasError={!!errors.month_day}
                  className="w-20"
                />
              </div>
            )}
          </div>
          {formData.frequency === "weekly" && (
            <div>
              <FieldLabel>{t(`${I18N_PREFIX}.fields.weekdays`)}</FieldLabel>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((day) => {
                  const isSelected = formData.weekdays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleWeekday(day)}
                      title={t(`${I18N_PREFIX}.weekday_long.${day}`)}
                      aria-pressed={isSelected}
                      className={cn(
                        "h-8 min-w-10 rounded-md border px-2 text-body-xs-medium transition-colors",
                        isSelected
                          ? "border-accent-strong bg-accent-primary text-on-color"
                          : "border-subtle bg-layer-2 text-secondary hover:bg-layer-2-hover"
                      )}
                    >
                      {t(`${I18N_PREFIX}.weekday_short.${day}`)}
                    </button>
                  );
                })}
              </div>
              <FieldError message={errors.weekdays} />
            </div>
          )}
          {formData.frequency === "monthly" && (
            <p className="-mt-2 text-caption-md-regular text-placeholder">
              {t(`${I18N_PREFIX}.fields.month_day_hint`)}
            </p>
          )}
          <FieldError message={errors.month_day} />

          <div className="flex flex-wrap items-end gap-4">
            <div>
              <FieldLabel>{t(`${I18N_PREFIX}.fields.start_date`)}</FieldLabel>
              <div className="h-7">
                <DateDropdown
                  value={formData.start_date}
                  onChange={(date) => handleChange("start_date", renderFormattedPayloadDate(date) ?? "")}
                  buttonVariant="border-with-text"
                  placeholder={t(`${I18N_PREFIX}.fields.start_date`)}
                  isClearable={false}
                />
              </div>
              <FieldError message={errors.start_date} />
            </div>
            <div>
              <FieldLabel>{t(`${I18N_PREFIX}.fields.end`)}</FieldLabel>
              <CustomSelect
                value={formData.end_type}
                onChange={(value: TRecurringWorkItemEndType) => handleChange("end_type", value)}
                label={t(`${I18N_PREFIX}.end_type.${formData.end_type}`)}
                buttonClassName="min-w-40"
                input
              >
                {END_TYPES.map((endType) => (
                  <CustomSelect.Option key={endType} value={endType}>
                    {t(`${I18N_PREFIX}.end_type.${endType}`)}
                  </CustomSelect.Option>
                ))}
              </CustomSelect>
            </div>
            {formData.end_type === "on_date" && (
              <div>
                <FieldLabel>{t(`${I18N_PREFIX}.fields.end_date`)}</FieldLabel>
                <div className="h-7">
                  <DateDropdown
                    value={formData.end_date}
                    onChange={(date) => handleChange("end_date", renderFormattedPayloadDate(date) ?? null)}
                    buttonVariant="border-with-text"
                    placeholder={t(`${I18N_PREFIX}.fields.end_date`)}
                  />
                </div>
              </div>
            )}
            {formData.end_type === "after_count" && (
              <div>
                <FieldLabel>{t(`${I18N_PREFIX}.fields.max_occurrences`)}</FieldLabel>
                <Input
                  type="number"
                  min={1}
                  value={formData.max_occurrences ?? ""}
                  onChange={(e) => handleChange("max_occurrences", parseNumber(e.target.value))}
                  hasError={!!errors.max_occurrences}
                  className="w-24"
                />
              </div>
            )}
          </div>
          <FieldError message={errors.end_date ?? errors.max_occurrences} />
          <div className="rounded-md bg-layer-2 px-3 py-2 text-body-xs-medium text-secondary">
            {getRuleSummary(t, formData, currentLocale)}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-subtle pt-4">
          <div className="flex items-center gap-2">
            <ToggleSwitch
              value={formData.is_active}
              onChange={(value) => handleChange("is_active", value)}
              label={t(`${I18N_PREFIX}.fields.active`)}
            />
            <span className="text-body-xs-regular text-secondary">{t(`${I18N_PREFIX}.fields.active`)}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="secondary" size="lg" type="button" onClick={handleClose}>
              {t("cancel")}
            </Button>
            <Button variant="primary" size="lg" type="submit" loading={isSubmitting}>
              {isEditing ? t("save") : t("common.create")}
            </Button>
          </div>
        </div>
      </form>
    </ModalCore>
  );
});
