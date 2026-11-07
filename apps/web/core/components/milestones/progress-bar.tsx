/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TMilestoneProgress } from "@plane/types";
import { cn } from "@plane/utils";

type Props = {
  progress: TMilestoneProgress;
  color: string;
  className?: string;
};

export function MilestoneProgressBar(props: Props) {
  const { progress, color, className } = props;
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-layer-3", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress.percentage}
    >
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${progress.percentage}%`, backgroundColor: color }}
      />
    </div>
  );
}
