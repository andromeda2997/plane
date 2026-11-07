/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { ArrowDownWideNarrow, ArrowUpWideNarrow, GripVertical } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { getButtonStyling } from "@plane/propel/button";
// types
import { CheckIcon } from "@plane/propel/icons";
import type { TPageFiltersSortBy, TPageFiltersSortKey } from "@plane/types";
import { CustomMenu } from "@plane/ui";

type Props = {
  onChange: (value: { key?: TPageFiltersSortKey; order?: TPageFiltersSortBy }) => void;
  sortBy: TPageFiltersSortBy;
  sortKey: TPageFiltersSortKey;
};

const PAGE_SORTING_KEY_OPTIONS: {
  key: TPageFiltersSortKey;
  label: string;
  // i18n-Schlüssel (hat Vorrang vor label)
  i18nLabel?: string;
}[] = [
  // Reihenfolge per Drag-and-Drop im Seitenbaum
  { key: "manual", label: "Manual", i18nLabel: "page_tree.sort_manual" },
  { key: "name", label: "Name" },
  { key: "created_at", label: "Date created" },
  { key: "updated_at", label: "Date modified" },
];

export function PageOrderByDropdown(props: Props) {
  const { onChange, sortBy, sortKey } = props;
  const { t } = useTranslation();

  const orderByDetails = PAGE_SORTING_KEY_OPTIONS.find((option) => sortKey === option.key);
  const getLabel = (option: (typeof PAGE_SORTING_KEY_OPTIONS)[number] | undefined) =>
    option?.i18nLabel ? t(option.i18nLabel) : option?.label;
  // manuelle Reihenfolge hat keine Richtung
  const isManual = sortKey === "manual";
  const isDescending = sortBy === "desc";

  return (
    <CustomMenu
      customButton={
        <div className={getButtonStyling("secondary", "lg")}>
          {isManual ? (
            <GripVertical className="size-3" />
          ) : !isDescending ? (
            <ArrowUpWideNarrow className="size-3" />
          ) : (
            <ArrowDownWideNarrow className="size-3" />
          )}
          {getLabel(orderByDetails)}
        </div>
      }
      placement="bottom-end"
      maxHeight="lg"
      closeOnSelect
    >
      {PAGE_SORTING_KEY_OPTIONS.map((option) => (
        <CustomMenu.MenuItem
          key={option.key}
          className="flex items-center justify-between gap-2"
          onClick={() =>
            onChange({
              key: option.key,
            })
          }
        >
          {getLabel(option)}
          {sortKey === option.key && <CheckIcon className="h-3 w-3" />}
        </CustomMenu.MenuItem>
      ))}
      {!isManual && (
        <>
          <hr className="my-2 border-subtle" />
          <CustomMenu.MenuItem
            className="flex items-center justify-between gap-2"
            onClick={() => {
              if (isDescending)
                onChange({
                  order: "asc",
                });
            }}
          >
            Ascending
            {!isDescending && <CheckIcon className="h-3 w-3" />}
          </CustomMenu.MenuItem>
          <CustomMenu.MenuItem
            className="flex items-center justify-between gap-2"
            onClick={() => {
              if (!isDescending)
                onChange({
                  order: "desc",
                });
            }}
          >
            Descending
            {isDescending && <CheckIcon className="h-3 w-3" />}
          </CustomMenu.MenuItem>
        </>
      )}
    </CustomMenu>
  );
}
