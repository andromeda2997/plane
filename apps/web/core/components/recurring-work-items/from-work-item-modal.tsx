/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
// plane imports
import type { TIssue, TRecurringWorkItemFormData } from "@plane/types";
// services
import { IssueService } from "@/services/issue/issue.service";
// local imports
import { workItemToFormData } from "./helpers";
import { CreateUpdateRecurringWorkItemModal } from "./modal";

const issueService = new IssueService();

type Props = {
  isOpen: boolean;
  onClose: () => void;
  workspaceSlug: string;
  issue: TIssue;
};

/** "Create as recurring" from a work item: prefills the modal with the values of the work item. */
export const CreateRecurringFromWorkItemModal = observer(function CreateRecurringFromWorkItemModal(props: Props) {
  const { isOpen, onClose, workspaceSlug, issue } = props;
  const [initialValues, setInitialValues] = useState<Partial<TRecurringWorkItemFormData> | null>(null);

  useEffect(() => {
    if (!isOpen || !issue.project_id) {
      setInitialValues(null);
      return;
    }
    let cancelled = false;
    const projectId = issue.project_id;
    // list layouts do not contain the description, so load the full work item
    const load = async () => {
      let values = workItemToFormData(issue);
      try {
        const fullIssue = await issueService.retrieve(workspaceSlug, projectId, issue.id);
        values = workItemToFormData({ ...issue, ...fullIssue });
      } catch {
        // fall back to the values from the list
      }
      if (!cancelled) setInitialValues(values);
    };
    void load();
    return () => {
      cancelled = true;
    };
    // oxlint-disable-next-line eslint-plugin-react-hooks/exhaustive-deps
  }, [isOpen, issue.id, issue.project_id, workspaceSlug]);

  if (!issue.project_id) return null;

  return (
    <CreateUpdateRecurringWorkItemModal
      isOpen={isOpen && initialValues !== null}
      onClose={onClose}
      workspaceSlug={workspaceSlug}
      projectId={issue.project_id}
      initialValues={initialValues ?? undefined}
    />
  );
});
