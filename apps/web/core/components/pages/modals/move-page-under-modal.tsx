/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import { Check } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { PageIcon } from "@plane/propel/icons";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EModalPosition, EModalWidth, Input, ModalCore } from "@plane/ui";
import { cn, getPageName } from "@plane/utils";
// hooks
import type { EPageStoreType } from "@/hooks/store";
import { usePageStore } from "@/hooks/store";
// store
import type { TPageInstance } from "@/store/pages/base-page";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  page: TPageInstance;
  storeType: EPageStoreType;
};

const TOP_LEVEL = "__top_level__";

export const MovePageUnderModal = observer(function MovePageUnderModal(props: Props) {
  const { isOpen, onClose, page, storeType } = props;
  // states
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // store hooks
  const { data, getPageById, getDescendantPageIds, getPageAncestorIds } = usePageStore(storeType);
  // translation
  const { t } = useTranslation();
  // derived values
  const currentParent = page.parent ?? null;
  const projectId = page.project_ids?.[0];

  const candidates = useMemo(() => {
    if (!page.id) return [];
    const excluded = new Set([page.id, ...getDescendantPageIds(page.id)]);
    const list = Object.values(data)
      .filter(
        (p) =>
          !!p.id &&
          !excluded.has(p.id) &&
          !p.archived_at &&
          (!projectId || p.project_ids?.includes(projectId)) &&
          (!page.workspace || p.workspace === page.workspace)
      )
      .map((p) => {
        const path = getPageAncestorIds(p.id as string)
          .map((id) => getPageName(getPageById(id)?.name))
          .concat(getPageName(p.name));
        return { id: p.id as string, label: getPageName(p.name), path: path.join(" / ") };
      })
      .filter((p) => p.path.toLowerCase().includes(query.trim().toLowerCase()));
    // neues Array aus map/filter -> Sortieren an Ort und Stelle ist unkritisch
    // oxlint-disable-next-line unicorn/no-array-sort
    return list.sort((a, b) => a.path.localeCompare(b.path));
  }, [data, getDescendantPageIds, getPageAncestorIds, getPageById, page.id, page.workspace, projectId, query]);

  const handleClose = () => {
    setQuery("");
    setSelected(null);
    setIsSubmitting(false);
    onClose();
  };

  const handleSubmit = async () => {
    if (selected === null) return;
    const newParent = selected === TOP_LEVEL ? null : selected;
    if (newParent === currentParent) return handleClose();
    setIsSubmitting(true);
    try {
      await page.setParent(newParent);
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("page_tree.toasts.moved") });
      handleClose();
    } catch (error) {
      const message = (error as { error?: string } | undefined)?.error;
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("page_tree.toasts.move_failed"),
        message,
      });
      setIsSubmitting(false);
    }
  };

  const renderOption = (id: string, label: string, sublabel?: string) => {
    const isCurrent = (id === TOP_LEVEL ? null : id) === currentParent;
    const isSelected = selected === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => setSelected(id)}
        className={cn(
          "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-13 hover:bg-layer-transparent-hover",
          { "bg-layer-transparent-hover": isSelected }
        )}
      >
        <PageIcon className="size-4 flex-shrink-0 text-tertiary" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-primary">{label}</span>
          {sublabel && sublabel !== label && <span className="truncate text-11 text-tertiary">{sublabel}</span>}
        </span>
        <span className="ml-auto flex flex-shrink-0 items-center gap-2">
          {isCurrent && <span className="text-11 text-tertiary">{t("page_tree.move_modal.current_parent")}</span>}
          {isSelected && <Check className="size-3.5 text-accent-primary" />}
        </span>
      </button>
    );
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={handleClose} position={EModalPosition.TOP} width={EModalWidth.XL}>
      <div className="flex flex-col gap-3 p-5">
        <h3 className="truncate text-16 font-medium text-primary">
          {t("page_tree.move_modal.title", { name: getPageName(page.name) })}
        </h3>
        <Input
          id="move-page-under-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("page_tree.move_modal.search_placeholder")}
          className="w-full"
        />
        <div className="vertical-scrollbar flex scrollbar-sm max-h-80 flex-col gap-0.5 overflow-y-auto">
          {renderOption(TOP_LEVEL, t("page_tree.move_modal.top_level"))}
          {candidates.map((c) => renderOption(c.id, c.label, c.path))}
          {candidates.length === 0 && query.trim() !== "" && (
            <p className="px-2 py-1.5 text-13 text-tertiary">{t("page_tree.move_modal.no_results")}</p>
          )}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-subtle px-5 py-3">
        <Button variant="secondary" size="lg" onClick={handleClose}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={handleSubmit}
          loading={isSubmitting}
          disabled={selected === null || isSubmitting}
        >
          {isSubmitting ? t("page_tree.move_modal.submitting") : t("page_tree.move_modal.submit")}
        </Button>
      </div>
    </ModalCore>
  );
});
