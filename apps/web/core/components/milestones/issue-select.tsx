/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { usePopper } from "react-popper";
import { Combobox } from "@headlessui/react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "@plane/propel/icons";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { ComboDropDown } from "@plane/ui";
import { cn, renderFormattedDate } from "@plane/utils";
// components
import { DropdownButton } from "@/components/dropdowns/buttons";
// hooks
import { useMilestone } from "@/hooks/store/use-milestone";
import { useDropdown } from "@/hooks/use-dropdown";
import { usePlatformOS } from "@/hooks/use-platform-os";
// local imports
import { getMilestoneDisplayColor } from "./helpers";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled?: boolean;
  className?: string;
};

function MilestoneDot({ color }: { color: string }) {
  return <span className="size-2 flex-shrink-0 rounded-full" style={{ backgroundColor: color }} />;
}

/** Feld „Meilenstein“ (Mehrfachauswahl) in den Eigenschaften eines Arbeitselements. */
export const IssueMilestoneSelect = observer(function IssueMilestoneSelect(props: Props) {
  const { workspaceSlug, projectId, issueId, disabled = false, className } = props;
  const { t } = useTranslation();
  // refs
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // states
  const [isOpen, setIsOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [query, setQuery] = useState("");
  const [referenceElement, setReferenceElement] = useState<HTMLButtonElement | null>(null);
  const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(null);
  // store hooks
  const {
    fetchedProjects,
    getMilestoneById,
    getProjectMilestones,
    getIssueMilestoneIds,
    fetchProjectMilestones,
    fetchIssueMilestones,
    setIssueMilestones,
  } = useMilestone();
  const { isMobile } = usePlatformOS();
  // derived values
  const value = getIssueMilestoneIds(issueId) ?? [];
  const milestones = getProjectMilestones(projectId);
  const isDisabled = disabled || isUpdating;

  useEffect(() => {
    if (!workspaceSlug || !projectId || !issueId) return;
    void fetchIssueMilestones(workspaceSlug, projectId, issueId).catch(() => undefined);
    if (!fetchedProjects[projectId]) void fetchProjectMilestones(workspaceSlug, projectId).catch(() => undefined);
    // oxlint-disable-next-line eslint-plugin-react-hooks/exhaustive-deps
  }, [workspaceSlug, projectId, issueId]);

  const { styles, attributes } = usePopper(referenceElement, popperElement, {
    placement: "bottom-start",
    modifiers: [{ name: "preventOverflow", options: { padding: 12 } }],
  });

  const { handleKeyDown, handleOnClick } = useDropdown({
    dropdownRef,
    inputRef,
    isOpen,
    onClose: () => setQuery(""),
    setIsOpen,
  });

  useEffect(() => {
    if (isOpen && !isMobile) inputRef.current?.focus();
  }, [isOpen, isMobile]);

  const handleChange = async (milestoneIds: string[]) => {
    setIsUpdating(true);
    try {
      await setIssueMilestones(workspaceSlug, projectId, issueId, milestoneIds);
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: `${t("error")}!`, message: t("milestone.toast.link_error") });
    } finally {
      setIsUpdating(false);
    }
  };

  const filtered = milestones.filter((milestone) =>
    query === "" ? true : milestone.name.toLowerCase().includes(query.toLowerCase())
  );

  const button = (
    <button
      ref={setReferenceElement}
      type="button"
      className={cn("clickable block h-full w-full text-left outline-none hover:bg-layer-1", {
        "cursor-not-allowed text-secondary": isDisabled,
        "cursor-pointer": !isDisabled,
      })}
      onClick={handleOnClick}
      disabled={isDisabled}
    >
      <DropdownButton
        className={cn("justify-between text-body-xs-medium", { "text-placeholder": value.length === 0 })}
        isActive={isOpen}
        tooltipHeading={t("milestone.label")}
        tooltipContent={value.map((id) => getMilestoneById(id)?.name).join(", ")}
        showTooltip={false}
        variant="transparent-with-text"
      >
        {value.length > 0 ? (
          <div className="flex max-w-full flex-grow flex-wrap items-center gap-2 truncate py-0.5">
            {value.map((milestoneId) => {
              const milestone = getMilestoneById(milestoneId);
              if (!milestone) return null;
              return (
                <div
                  key={milestoneId}
                  className="flex max-w-full items-center gap-1 rounded-sm bg-layer-1 px-2 py-1 text-secondary"
                >
                  <MilestoneDot color={getMilestoneDisplayColor(milestone)} />
                  <span className="max-w-40 truncate text-11 font-medium">{milestone.name}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <span className="flex-grow truncate text-left">{t("milestone.no_milestone")}</span>
        )}
        {!isDisabled && <ChevronDownIcon className="hidden h-3.5 w-3.5 flex-shrink-0 group-hover:inline" />}
      </DropdownButton>
    </button>
  );

  return (
    <div className={cn("flex h-full items-center gap-1", className)}>
      {/* oxlint-disable-next-line jsx_a11y/no-static-element-interactions */}
      <ComboDropDown
        as="div"
        ref={dropdownRef}
        className="group h-full w-full"
        onKeyDown={handleKeyDown}
        button={button}
        value={value}
        onChange={(ids: string[]) => void handleChange(ids)}
        disabled={isDisabled}
        multiple
      >
        {isOpen && (
          <Combobox.Options className="fixed z-10" static>
            <div
              className="my-1 w-56 rounded-sm border-[0.5px] border-strong bg-surface-1 px-2 py-2.5 text-11 shadow-raised-200 focus:outline-none"
              ref={setPopperElement}
              style={styles.popper}
              {...attributes.popper}
            >
              <div className="flex items-center gap-1.5 rounded-sm border border-subtle bg-surface-2 px-2">
                <SearchIcon className="h-3.5 w-3.5 text-placeholder" strokeWidth={1.5} />
                <Combobox.Input
                  as="input"
                  ref={inputRef}
                  className="w-full bg-transparent py-1 text-11 text-secondary placeholder:text-placeholder focus:outline-none"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("common.search.label")}
                />
              </div>
              <div className="mt-2 max-h-48 space-y-1 overflow-y-scroll">
                {!fetchedProjects[projectId] ? (
                  <p className="px-1.5 py-1 text-placeholder italic">{t("common.loading")}</p>
                ) : filtered.length > 0 ? (
                  filtered.map((milestone) => (
                    <Combobox.Option
                      key={milestone.id}
                      value={milestone.id}
                      className={({ active, selected }) =>
                        cn(
                          "flex w-full cursor-pointer items-center justify-between gap-2 truncate rounded-sm px-1 py-1.5 select-none",
                          {
                            "bg-layer-transparent-hover": active,
                            "text-primary": selected,
                            "text-secondary": !selected,
                          }
                        )
                      }
                    >
                      {({ selected }) => (
                        <>
                          <span className="flex min-w-0 flex-grow items-center gap-2">
                            <MilestoneDot color={getMilestoneDisplayColor(milestone)} />
                            <span className="truncate">{milestone.name}</span>
                            <span className="ml-auto flex-shrink-0 text-placeholder">
                              {renderFormattedDate(milestone.date)}
                            </span>
                          </span>
                          {selected && <CheckIcon className="h-3.5 w-3.5 flex-shrink-0" />}
                        </>
                      )}
                    </Combobox.Option>
                  ))
                ) : (
                  <p className="px-1.5 py-1 text-placeholder italic">
                    {milestones.length === 0 ? t("milestone.empty_short") : t("common.search.no_matching_results")}
                  </p>
                )}
              </div>
            </div>
          </Combobox.Options>
        )}
      </ComboDropDown>
    </div>
  );
});
