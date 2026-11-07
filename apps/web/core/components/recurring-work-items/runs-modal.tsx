/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Link } from "react-router";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import type { TRecurringWorkItem } from "@plane/types";
import { EModalPosition, EModalWidth, Loader, ModalCore } from "@plane/ui";
import { cn, generateWorkItemLink } from "@plane/utils";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useRecurringWorkItem } from "@/hooks/store/use-recurring-work-item";
// local imports
import { I18N_PREFIX, formatLocalDate } from "./helpers";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  workspaceSlug: string;
  projectId: string;
  item: TRecurringWorkItem | null;
};

export const RecurringWorkItemRunsModal = observer(function RecurringWorkItemRunsModal(props: Props) {
  const { isOpen, onClose, workspaceSlug, projectId, item } = props;
  // states
  const [isLoading, setIsLoading] = useState(false);
  // plane hooks
  const { t, currentLocale } = useTranslation();
  // store hooks
  const { runsMap, fetchRuns } = useRecurringWorkItem();
  const { getProjectIdentifierById } = useProject();
  // derived values
  const runs = item ? runsMap[item.id] : undefined;
  const projectIdentifier = getProjectIdentifierById(projectId);

  useEffect(() => {
    if (!isOpen || !item) return;
    setIsLoading(true);
    fetchRuns(workspaceSlug, projectId, item.id)
      .catch(() => undefined)
      .finally(() => setIsLoading(false));
  }, [isOpen, item, workspaceSlug, projectId, fetchRuns]);

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} position={EModalPosition.TOP} width={EModalWidth.XXL}>
      <div className="flex flex-col gap-4 p-5">
        <h3 className="text-h5-medium text-primary">{t(`${I18N_PREFIX}.history.title`, { name: item?.name ?? "" })}</h3>
        {isLoading && !runs ? (
          <Loader className="space-y-2">
            <Loader.Item height="32px" />
            <Loader.Item height="32px" />
          </Loader>
        ) : !runs || runs.length === 0 ? (
          <p className="text-body-xs-regular text-tertiary">{t(`${I18N_PREFIX}.history.empty`)}</p>
        ) : (
          <div className="max-h-[60vh] divide-y divide-subtle overflow-y-auto rounded-md border border-subtle">
            {runs.map((run) => {
              const link =
                run.issue && run.issue_sequence_id
                  ? generateWorkItemLink({
                      workspaceSlug,
                      projectId,
                      issueId: run.issue,
                      projectIdentifier,
                      sequenceId: run.issue_sequence_id,
                    })
                  : null;
              return (
                <div key={run.id} className="flex flex-col gap-1 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2 text-body-xs-regular">
                    <span className="font-medium text-primary">
                      {formatLocalDate(run.occurrence_date, currentLocale)}
                    </span>
                    <span
                      className={cn(
                        "rounded-sm px-1.5 py-0.5 text-caption-sm-medium",
                        run.status === "success"
                          ? "bg-success-subtle text-success-primary"
                          : "bg-danger-subtle text-danger-primary"
                      )}
                    >
                      {t(`${I18N_PREFIX}.history.${run.status}`)}
                    </span>
                    <span className="text-tertiary">{t(`${I18N_PREFIX}.history.${run.trigger}`)}</span>
                    <span className="ml-auto truncate">
                      {link ? (
                        <Link to={link} className="text-link-primary hover:underline">
                          {projectIdentifier}-{run.issue_sequence_id} {run.issue_name}
                        </Link>
                      ) : run.status === "success" ? (
                        <span className="text-placeholder">{t(`${I18N_PREFIX}.history.deleted_work_item`)}</span>
                      ) : null}
                    </span>
                  </div>
                  {run.error && <p className="text-caption-md-regular break-words text-danger-primary">{run.error}</p>}
                  {run.warnings?.length > 0 && (
                    <p className="text-caption-md-regular text-tertiary">
                      {run.warnings.map((warning) => t(`${I18N_PREFIX}.warnings.${warning}`)).join(" · ")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="flex justify-end">
          <Button variant="secondary" size="lg" onClick={onClose}>
            {t("close")}
          </Button>
        </div>
      </div>
    </ModalCore>
  );
});
