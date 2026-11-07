/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { isEqual, set } from "lodash-es";
import { action, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// components
import type {
  ChartDataType,
  IBlockUpdateDependencyData,
  IGanttBlock,
  TGanttViews,
  EGanttBlockType,
} from "@plane/types";
import { renderFormattedPayloadDate } from "@plane/utils";
import { currentViewDataWithView } from "@/components/gantt-chart/data";
import type { TDependencyAnchor, TGanttDependency } from "@/components/gantt-chart/dependencies/helpers";
import { getRequiredShift } from "@/components/gantt-chart/dependencies/helpers";
import {
  getDateFromPositionOnGantt,
  getItemPositionWidth,
  getPositionFromDate,
} from "@/components/gantt-chart/views/helpers";
// helpers
// store
import type { RootStore } from "@/store/root.store";

// types
/** State of a connection that is being dragged from a block edge to create a dependency. */
export type TDependencyDraft = {
  sourceId: string;
  sourceAnchor: TDependencyAnchor;
  pointer: { x: number; y: number };
  targetId?: string;
  targetAnchor?: TDependencyAnchor;
};

type BlockData = {
  id: string;
  name: string;
  sort_order: number | null;
  start_date?: string | undefined | null;
  target_date?: string | undefined | null;
  project_id?: string | undefined | null;
};

export interface IBaseTimelineStore {
  // observables
  currentView: TGanttViews;
  currentViewData: ChartDataType | undefined;
  activeBlockId: string | null;
  renderView: any;
  isDragging: boolean;
  isDependencyEnabled: boolean;
  //
  setBlockIds: (ids: string[]) => void;
  getBlockById: (blockId: string) => IGanttBlock;
  // computed functions
  getIsCurrentDependencyDragging: (blockId: string) => boolean;
  getBlockDependencies: () => TGanttDependency[];
  getRelatedBlockIds: (blockId: string) => string[];
  dependencyDraft: TDependencyDraft | undefined;
  setDependencyDraft: (draft: TDependencyDraft | undefined) => void;
  createBlockDependency: (draft: Required<TDependencyDraft>) => Promise<void>;
  removeBlockDependency: (dependency: TGanttDependency) => Promise<void>;
  isBlockActive: (blockId: string) => boolean;
  // actions
  updateCurrentView: (view: TGanttViews) => void;
  updateCurrentViewData: (data: ChartDataType | undefined) => void;
  updateActiveBlockId: (blockId: string | null) => void;
  updateRenderView: (data: any) => void;
  updateAllBlocksOnChartChangeWhileDragging: (addedWidth: number) => void;
  getUpdatedPositionAfterDrag: (
    id: string,
    shouldUpdateHalfBlock: boolean,
    ignoreDependencies?: boolean
  ) => IBlockUpdateDependencyData[];
  updateBlockPosition: (id: string, deltaLeft: number, deltaWidth: number, ignoreDependencies?: boolean) => void;
  getNumberOfDaysFromPosition: (position: number | undefined) => number | undefined;
  setIsDragging: (isDragging: boolean) => void;
  initGantt: () => void;

  getDateFromPositionOnGantt: (position: number, offsetDays: number) => Date | undefined;
  getPositionFromDateOnGantt: (date: string | Date, offSetWidth: number) => number | undefined;
}

export class BaseTimeLineStore implements IBaseTimelineStore {
  blocksMap: Record<string, IGanttBlock> = {};
  blockIds: string[] | undefined = undefined;

  isDragging: boolean = false;
  currentView: TGanttViews = "week";
  currentViewData: ChartDataType | undefined = undefined;
  activeBlockId: string | null = null;
  renderView: any = [];

  rootStore: RootStore;

  isDependencyEnabled = false;
  dependencyDraft: TDependencyDraft | undefined = undefined;

  // positions of all blocks at the start of a drag, used to move dependent blocks along
  private dependencyDragSnapshot: Record<string, { marginLeft: number; width: number }> | undefined = undefined;
  // blocks that were moved along with the dragged block during the current drag
  private dependencyShiftedBlockIds = new Set<string>();

  constructor(_rootStore: RootStore) {
    makeObservable(this, {
      // observables
      blocksMap: observable,
      blockIds: observable,
      isDragging: observable.ref,
      currentView: observable.ref,
      currentViewData: observable,
      activeBlockId: observable.ref,
      dependencyDraft: observable.ref,
      renderView: observable,
      // actions
      setIsDragging: action,
      setBlockIds: action.bound,
      initGantt: action.bound,
      updateCurrentView: action.bound,
      updateCurrentViewData: action.bound,
      updateActiveBlockId: action.bound,
      updateRenderView: action.bound,
      setDependencyDraft: action.bound,
    });

    this.initGantt();

    this.rootStore = _rootStore;
  }

  /**
   * Update Block Ids to derive blocks from
   * @param ids
   */
  setBlockIds = (ids: string[]) => {
    this.blockIds = ids;
  };

  /**
   * setIsDragging
   * @param isDragging
   */
  setIsDragging = (isDragging: boolean) => {
    runInAction(() => {
      this.isDragging = isDragging;
    });
  };

  /**
   * @description check if block is active
   * @param {string} blockId
   */
  isBlockActive = computedFn((blockId: string): boolean => this.activeBlockId === blockId);

  /**
   * @description update current view
   * @param {TGanttViews} view
   */
  updateCurrentView = (view: TGanttViews) => {
    this.currentView = view;
  };

  /**
   * @description update current view data
   * @param {ChartDataType | undefined} data
   */
  updateCurrentViewData = (data: ChartDataType | undefined) => {
    runInAction(() => {
      this.currentViewData = data;
    });
  };

  /**
   * @description update active block
   * @param {string | null} block
   */
  updateActiveBlockId = (blockId: string | null) => {
    this.activeBlockId = blockId;
  };

  /**
   * @description update render view
   * @param {any[]} data
   */
  updateRenderView = (data: any[]) => {
    this.renderView = data;
  };

  /**
   * @description initialize gantt chart with month view
   */
  initGantt = () => {
    const newCurrentViewData = currentViewDataWithView(this.currentView);

    runInAction(() => {
      this.currentViewData = newCurrentViewData;
      this.blocksMap = {};
      this.blockIds = undefined;
    });
  };

  /** Gets Block from Id */
  getBlockById = computedFn((blockId: string) => this.blocksMap[blockId]);

  /**
   * updates the BlocksMap from blockIds
   * @param getDataById
   * @returns
   */
  updateBlocks(getDataById: (id: string) => BlockData | undefined | null, type?: EGanttBlockType, index?: number) {
    if (!this.blockIds || !Array.isArray(this.blockIds) || this.isDragging) return true;

    const updatedBlockMaps: { path: string[]; value: any }[] = [];
    const newBlocks: IGanttBlock[] = [];

    // Loop through blockIds to generate blocks Data
    for (const blockId of this.blockIds) {
      const blockData = getDataById(blockId);
      if (!blockData) continue;

      const block: IGanttBlock = {
        data: blockData,
        id: blockData?.id,
        name: blockData.name,
        sort_order: blockData?.sort_order ?? undefined,
        start_date: blockData?.start_date ?? undefined,
        target_date: blockData?.target_date ?? undefined,
        meta: {
          type,
          index,
          project_id: blockData?.project_id,
        },
      };
      if (this.currentViewData && (this.currentViewData?.data?.startDate || this.currentViewData?.data?.dayWidth)) {
        block.position = getItemPositionWidth(this.currentViewData, block);
      }

      // create block updates if the block already exists, or push them to newBlocks
      if (this.blocksMap[blockId]) {
        for (const key of Object.keys(block)) {
          const currValue = this.blocksMap[blockId][key as keyof IGanttBlock];
          const nextValue = block[key as keyof IGanttBlock];
          if (!isEqual(currValue, nextValue)) {
            updatedBlockMaps.push({ path: [blockId, key], value: nextValue });
          }
        }
      } else {
        newBlocks.push(block);
      }
    }

    // update the store with the block updates
    runInAction(() => {
      for (const updatedBlock of updatedBlockMaps) {
        set(this.blocksMap, updatedBlock.path, updatedBlock.value);
      }

      for (const newBlock of newBlocks) {
        set(this.blocksMap, [newBlock.id], newBlock);
      }
    });
  }

  /**
   * returns number of days that the position pixels span across the timeline chart
   * @param position
   * @returns
   */
  getNumberOfDaysFromPosition = (position: number | undefined) => {
    if (!this.currentViewData || !position) return;

    return Math.round(position / this.currentViewData.data.dayWidth);
  };

  /**
   * returns position of the date on chart
   */
  getPositionFromDateOnGantt = computedFn((date: string | Date, offSetWidth: number) => {
    if (!this.currentViewData) return;

    return getPositionFromDate(this.currentViewData, date, offSetWidth);
  });

  /**
   * returns the date at which the position corresponds to on the timeline chart
   */
  getDateFromPositionOnGantt = computedFn((position: number, offsetDays: number) => {
    if (!this.currentViewData) return;

    return getDateFromPositionOnGantt(position, this.currentViewData, offsetDays);
  });

  /**
   * Adds width on Chart position change while the blocks are being dragged
   * @param addedWidth
   */
  updateAllBlocksOnChartChangeWhileDragging = action((addedWidth: number) => {
    if (!this.blockIds || !this.isDragging) return;

    runInAction(() => {
      this.blockIds?.forEach((blockId) => {
        const currBlock = this.blocksMap[blockId];

        if (!currBlock || !currBlock.position) return;

        currBlock.position.marginLeft += addedWidth;
      });
      if (this.dependencyDragSnapshot) {
        for (const position of Object.values(this.dependencyDragSnapshot)) position.marginLeft += addedWidth;
      }
    });
  });

  /**
   * returns updates dates of blocks post drag.
   * @param id
   * @param shouldUpdateHalfBlock if is a half block then update the incomplete block only if this is true
   * @returns
   */
  getUpdatedPositionAfterDrag = action((id: string, shouldUpdateHalfBlock: boolean, ignoreDependencies = false) => {
    const currBlock = this.blocksMap[id];
    const shiftedBlockIds = ignoreDependencies
      ? []
      : [...this.dependencyShiftedBlockIds].filter((blockId) => blockId !== id);
    this.resetDependencyDragState();

    if (!currBlock?.position || !this.currentViewData) return [];

    const updatePayload: IBlockUpdateDependencyData = { id, meta: currBlock.meta };

    // If shouldUpdateHalfBlock or the start date is available then update start date
    if (shouldUpdateHalfBlock || currBlock.start_date) {
      updatePayload.start_date = renderFormattedPayloadDate(
        getDateFromPositionOnGantt(currBlock.position.marginLeft, this.currentViewData)
      );
    }
    // If shouldUpdateHalfBlock or the target date is available then update target date
    if (shouldUpdateHalfBlock || currBlock.target_date) {
      updatePayload.target_date = renderFormattedPayloadDate(
        getDateFromPositionOnGantt(currBlock.position.marginLeft + currBlock.position.width, this.currentViewData, -1)
      );
    }

    const updates: IBlockUpdateDependencyData[] = [updatePayload];
    // dependent blocks keep their duration, so both dates are derived from the new position
    for (const blockId of shiftedBlockIds) {
      const block = this.blocksMap[blockId];
      if (!block?.position) continue;
      updates.push({
        id: blockId,
        meta: block.meta,
        start_date: renderFormattedPayloadDate(
          getDateFromPositionOnGantt(block.position.marginLeft, this.currentViewData)
        ),
        target_date: renderFormattedPayloadDate(
          getDateFromPositionOnGantt(block.position.marginLeft + block.position.width, this.currentViewData, -1)
        ),
      });
    }

    return updates;
  });

  /**
   * updates the block's position such as marginLeft and width while dragging
   * @param id
   * @param deltaLeft
   * @param deltaWidth
   * @returns
   */
  updateBlockPosition = action((id: string, deltaLeft: number, deltaWidth: number, ignoreDependencies = false) => {
    const currBlock = this.blocksMap[id];

    if (!currBlock?.position) return;

    const newMarginLeft = currBlock.position.marginLeft + deltaLeft;
    const newWidth = currBlock.position.width + deltaWidth;

    runInAction(() => {
      if (this.isDependencyEnabled) this.restoreShiftedBlocks(id);

      set(this.blocksMap, [id, "position"], {
        marginLeft: newMarginLeft ?? currBlock.position?.marginLeft,
        width: newWidth ?? currBlock.position?.width,
      });

      if (this.isDependencyEnabled && !ignoreDependencies) this.moveDependentBlocks(id);
    });
  });

  /**
   * Returns the dependencies between the blocks of the chart. The base timeline has none.
   */
  getBlockDependencies(): TGanttDependency[] {
    return [];
  }

  /**
   * Returns the ids of all blocks that are related to the given block in any way.
   */
  getRelatedBlockIds(_blockId: string): string[] {
    return [];
  }

  /**
   * Persists a dependency that was created by dragging a connection between two blocks.
   */
  async createBlockDependency(_draft: Required<TDependencyDraft>): Promise<void> {}

  /**
   * Removes a dependency between two blocks.
   */
  async removeBlockDependency(_dependency: TGanttDependency): Promise<void> {}

  setDependencyDraft = (draft: TDependencyDraft | undefined) => {
    this.dependencyDraft = draft;
  };

  /**
   * Moves blocks that were pushed by a dependency during the current drag back to where they were
   * when the drag started, so that dependencies can be recalculated from scratch on every move.
   */
  private restoreShiftedBlocks(draggedBlockId: string) {
    if (!this.dependencyDragSnapshot) {
      this.dependencyDragSnapshot = {};
      for (const [blockId, block] of Object.entries(this.blocksMap)) {
        if (block?.position) this.dependencyDragSnapshot[blockId] = { ...block.position };
      }
    }
    for (const blockId of this.dependencyShiftedBlockIds) {
      const original = this.dependencyDragSnapshot[blockId];
      if (blockId !== draggedBlockId && original) set(this.blocksMap, [blockId, "position"], { ...original });
    }
    this.dependencyShiftedBlockIds.clear();
  }

  /**
   * Restores all dependencies around the dragged block: successors are pushed to the right and
   * predecessors to the left, transitively. Blocks keep their duration. Dependencies that were
   * already violated before the drag started are left alone.
   */
  private moveDependentBlocks(rootBlockId: string) {
    const dependencies = this.getBlockDependencies();
    if (!dependencies.length) return;

    const outgoing = new Map<string, TGanttDependency[]>();
    const incoming = new Map<string, TGanttDependency[]>();
    for (const dependency of dependencies) {
      outgoing.set(dependency.predecessorId, [...(outgoing.get(dependency.predecessorId) ?? []), dependency]);
      incoming.set(dependency.successorId, [...(incoming.get(dependency.successorId) ?? []), dependency]);
    }

    const snapshot = this.dependencyDragSnapshot ?? {};
    const wasSatisfied = (dependency: TGanttDependency) => {
      const predecessor = snapshot[dependency.predecessorId];
      const successor = snapshot[dependency.successorId];
      return !predecessor || !successor || getRequiredShift(dependency.type, predecessor, successor) <= 0.5;
    };
    // only blocks with both dates can be moved as a whole
    const getMovablePosition = (blockId: string) => {
      const block = this.blocksMap[blockId];
      return blockId !== rootBlockId && block?.position && block.start_date && block.target_date
        ? block.position
        : undefined;
    };
    const queue = [rootBlockId];
    const moveBlock = (blockId: string, position: { marginLeft: number; width: number }, delta: number) => {
      set(this.blocksMap, [blockId, "position"], { marginLeft: position.marginLeft + delta, width: position.width });
      this.dependencyShiftedBlockIds.add(blockId);
      queue.push(blockId);
    };

    // guard against dependency cycles
    let remainingSteps = dependencies.length * 20 + 100;
    while (queue.length && remainingSteps-- > 0) {
      const blockId = queue.shift() as string;
      const position = this.blocksMap[blockId]?.position;
      if (!position) continue;

      for (const dependency of outgoing.get(blockId) ?? []) {
        const successorPosition = getMovablePosition(dependency.successorId);
        if (!successorPosition || !wasSatisfied(dependency)) continue;
        const shift = getRequiredShift(dependency.type, position, successorPosition);
        if (shift > 0.5) moveBlock(dependency.successorId, successorPosition, shift);
      }

      for (const dependency of incoming.get(blockId) ?? []) {
        const predecessorPosition = getMovablePosition(dependency.predecessorId);
        if (!predecessorPosition || !wasSatisfied(dependency)) continue;
        const shift = getRequiredShift(dependency.type, predecessorPosition, position);
        if (shift > 0.5) moveBlock(dependency.predecessorId, predecessorPosition, -shift);
      }
    }
  }

  private resetDependencyDragState() {
    this.dependencyDragSnapshot = undefined;
    this.dependencyShiftedBlockIds.clear();
  }

  /** Whether a dependency connection is currently being dragged from the given block. */
  getIsCurrentDependencyDragging = computedFn((blockId: string) => this.dependencyDraft?.sourceId === blockId);
}
