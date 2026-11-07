/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { autorun } from "mobx";
import type { RootStore } from "@/store/root.store";
import type { IBaseTimelineStore } from "@/store/timeline/base-timeline.store";
import { BaseTimeLineStore } from "@/store/timeline/base-timeline.store";
import type { TGanttDependency } from "@/components/gantt-chart/dependencies/helpers";
import { getGanttDependencies, getRelationTypeForConnection } from "@/components/gantt-chart/dependencies/helpers";
import type { TDependencyDraft } from "@/store/timeline/base-timeline.store";

export interface IIssuesTimeLineStore extends IBaseTimelineStore {
  isDependencyEnabled: boolean;
}

export class IssuesTimeLineStore extends BaseTimeLineStore implements IIssuesTimeLineStore {
  constructor(_rootStore: RootStore) {
    super(_rootStore);

    // work items support finish-to-start dependencies ("blocked by" / "blocking")
    this.isDependencyEnabled = true;

    autorun(() => {
      const getIssueById = this.rootStore.issue.issues.getIssueById;
      this.updateBlocks(getIssueById);
    });
  }

  /**
   * Finish-to-start dependencies between the work items currently on the chart.
   */
  getBlockDependencies(): TGanttDependency[] {
    return getGanttDependencies(this.blockIds ?? [], this.rootStore.issue.issueDetail.relation.relationMap);
  }

  /**
   * All work items related to the given one, regardless of the relation type.
   * The backend allows only one relation per pair of work items.
   */
  getRelatedBlockIds(blockId: string): string[] {
    const relations = this.rootStore.issue.issueDetail.relation.relationMap[blockId];
    return relations ? Object.values(relations).flat() : [];
  }

  async createBlockDependency(draft: Required<TDependencyDraft>): Promise<void> {
    const relationType = getRelationTypeForConnection(draft.sourceAnchor, draft.targetAnchor);
    if (!relationType) return;
    await this.rootStore.issue.issueDetail.relation.createCurrentRelation(draft.sourceId, relationType, draft.targetId);
  }

  async removeBlockDependency(dependency: TGanttDependency): Promise<void> {
    const workspaceSlug = this.rootStore.issue.workspaceSlug;
    const projectId = this.rootStore.issue.issues.getIssueById(dependency.predecessorId)?.project_id;
    if (!workspaceSlug || !projectId) return;
    await this.rootStore.issue.issueDetail.relation.removeRelation(
      workspaceSlug,
      projectId,
      dependency.predecessorId,
      dependency.relationType,
      dependency.successorId
    );
  }
}
