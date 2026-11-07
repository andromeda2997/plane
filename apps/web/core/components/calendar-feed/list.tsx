/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import type { TCalendarFeed, TCalendarFeedWithUrl } from "@plane/types";
// local imports
import { CalendarFeedListItem } from "./list-item";

type Props = {
  feeds: TCalendarFeed[];
  isLoading: boolean;
  showScope?: boolean;
  onRegenerated: (feed: TCalendarFeedWithUrl) => void;
};

export const CalendarFeedList = observer(function CalendarFeedList(props: Props) {
  const { feeds, isLoading, showScope, onRegenerated } = props;
  const { t } = useTranslation();

  return (
    <div className="flex flex-col">
      <h4 className="text-14 font-medium text-primary">{t("calendar_feed.list.title")}</h4>
      {feeds.length === 0 ? (
        <p className="py-3 text-13 text-tertiary">{isLoading ? `${t("loading")}...` : t("calendar_feed.list.empty")}</p>
      ) : (
        feeds.map((feed) => (
          <CalendarFeedListItem key={feed.id} feed={feed} showScope={showScope} onRegenerated={onRegenerated} />
        ))
      )}
    </div>
  );
});
