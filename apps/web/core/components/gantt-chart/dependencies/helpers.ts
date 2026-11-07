/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { IGanttBlock, TIssueRelationTypes } from "@plane/types";

/** Edge of a block a dependency is attached to. */
export type TDependencyAnchor = "START" | "END";

/**
 * Supported scheduling dependencies:
 * - FS (finish to start): the successor starts after the predecessor has finished ("blocking")
 * - SS (start to start): the successor starts at or after the start of the predecessor ("start_before")
 * - FF (finish to finish): the successor finishes at or after the end of the predecessor ("finish_before")
 */
export type TDependencyType = "FS" | "SS" | "FF";

/** Relation type as stored on the predecessor. */
export type TDependencyRelationType = Extract<TIssueRelationTypes, "blocking" | "start_before" | "finish_before">;

export type TGanttDependency = {
  id: string;
  predecessorId: string;
  successorId: string;
  type: TDependencyType;
  relationType: TDependencyRelationType;
};

type TBlockPosition = NonNullable<IGanttBlock["position"]>;

type TRelationLookup = Record<string, Partial<Record<string, string[]>> | undefined>;

const DEPENDENCY_DEFINITIONS: {
  type: TDependencyType;
  relationType: TDependencyRelationType;
  reverseRelationType: TIssueRelationTypes;
}[] = [
  { type: "FS", relationType: "blocking", reverseRelationType: "blocked_by" },
  { type: "SS", relationType: "start_before", reverseRelationType: "start_after" },
  { type: "FF", relationType: "finish_before", reverseRelationType: "finish_after" },
];

/** Which edge of the predecessor and of the successor a dependency type connects. */
export const DEPENDENCY_ANCHORS: Record<TDependencyType, { from: TDependencyAnchor; to: TDependencyAnchor }> = {
  FS: { from: "END", to: "START" },
  SS: { from: "START", to: "START" },
  FF: { from: "END", to: "END" },
};

/**
 * Builds the list of scheduling dependencies between the given blocks from the relation map.
 * Relations to blocks outside of `blockIds` are ignored, both directions of a relation result in one dependency.
 */
export const getGanttDependencies = (blockIds: string[], relationMap: TRelationLookup): TGanttDependency[] => {
  const visibleIds = new Set(blockIds);
  const dependencies = new Map<string, TGanttDependency>();

  const add = (predecessorId: string, successorId: string, definition: (typeof DEPENDENCY_DEFINITIONS)[number]) => {
    if (predecessorId === successorId || !visibleIds.has(predecessorId) || !visibleIds.has(successorId)) return;
    const id = `${definition.type}:${predecessorId}:${successorId}`;
    if (dependencies.has(id)) return;
    dependencies.set(id, {
      id,
      predecessorId,
      successorId,
      type: definition.type,
      relationType: definition.relationType,
    });
  };

  for (const blockId of blockIds) {
    const relations = relationMap[blockId];
    if (!relations) continue;
    for (const definition of DEPENDENCY_DEFINITIONS) {
      relations[definition.relationType]?.forEach((successorId) => add(blockId, successorId, definition));
      relations[definition.reverseRelationType]?.forEach((predecessorId) => add(predecessorId, blockId, definition));
    }
  }

  return [...dependencies.values()];
};

/** x coordinate of a block edge on the chart. */
export const getAnchorX = (position: TBlockPosition, anchor: TDependencyAnchor) =>
  anchor === "START" ? position.marginLeft : position.marginLeft + position.width;

/**
 * Returns by how many pixels the successor would have to move to the right (or the predecessor to the left)
 * to satisfy the dependency. A value <= 0 means the dependency is satisfied.
 * Positions are day aligned and the end of a block is the start of the day after its target date.
 */
export const getRequiredShift = (type: TDependencyType, predecessor: TBlockPosition, successor: TBlockPosition) => {
  const { from, to } = DEPENDENCY_ANCHORS[type];
  return getAnchorX(predecessor, from) - getAnchorX(successor, to);
};

export const isDependencyViolated = (type: TDependencyType, predecessor: TBlockPosition, successor: TBlockPosition) =>
  getRequiredShift(type, predecessor, successor) > 0.5;

/**
 * Relation that is created when a connection is dragged from one block edge to another.
 * Dragging from the start of a block to the end of another block is not a supported dependency.
 */
export const getRelationTypeForConnection = (
  sourceAnchor: TDependencyAnchor,
  targetAnchor: TDependencyAnchor
): TDependencyRelationType | undefined => {
  if (sourceAnchor === "END" && targetAnchor === "START") return "blocking";
  if (sourceAnchor === "START" && targetAnchor === "START") return "start_before";
  if (sourceAnchor === "END" && targetAnchor === "END") return "finish_before";
  return undefined;
};
