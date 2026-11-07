/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { CopyIcon } from "@plane/propel/icons";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { copyTextToClipboard } from "@plane/utils";

type Props = {
  /** Klartext-URL – nur hier im Komponenten-Zustand, nie im Store. */
  url: string | null;
  onClose: () => void;
};

export function CalendarFeedCreatedModal(props: Props) {
  const { url, onClose } = props;
  const { t } = useTranslation();

  const handleCopy = () => {
    if (!url) return;
    void copyTextToClipboard(url).then(() =>
      setToast({ type: TOAST_TYPE.SUCCESS, title: `${t("success")}!`, message: t("calendar_feed.created.copied") })
    );
  };

  return (
    <ModalCore isOpen={!!url} handleClose={onClose} position={EModalPosition.CENTER} width={EModalWidth.XXL}>
      <div className="flex flex-col gap-4 p-5">
        <div className="space-y-1">
          <h3 className="text-16 leading-6 font-medium text-primary">{t("calendar_feed.created.title")}</h3>
          <p className="text-13 text-tertiary">{t("calendar_feed.created.description")}</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={url ?? ""}
            onFocus={(event) => event.currentTarget.select()}
            aria-label={t("calendar_feed.settings_label")}
            className="font-mono w-full min-w-0 rounded-md border-[0.5px] border-subtle bg-layer-1 px-3 py-2 text-12 text-primary outline-none"
          />
          <Button variant="primary" onClick={handleCopy} prependIcon={<CopyIcon className="size-3.5" />}>
            {t("calendar_feed.created.copy")}
          </Button>
        </div>
        <CalendarFeedInstructions />
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            {t("calendar_feed.created.close")}
          </Button>
        </div>
      </div>
    </ModalCore>
  );
}

export function CalendarFeedInstructions() {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border-[0.5px] border-subtle bg-layer-1 px-4 py-3 text-13 text-secondary">
      <p className="font-medium text-primary">{t("calendar_feed.instructions.title")}</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>{t("calendar_feed.instructions.step_1")}</li>
        <li>{t("calendar_feed.instructions.step_2")}</li>
        <li>{t("calendar_feed.instructions.step_3")}</li>
      </ol>
      <p className="mt-2 text-12 text-tertiary">{t("calendar_feed.instructions.delay")}</p>
    </div>
  );
}
