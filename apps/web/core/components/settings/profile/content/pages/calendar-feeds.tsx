/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
// components
import { ProfileCalendarFeedsRoot } from "@/components/calendar-feed";
import { ProfileSettingsHeading } from "@/components/settings/profile/heading";

export const CalendarFeedsProfileSettings = observer(function CalendarFeedsProfileSettings() {
  const { t } = useTranslation();

  return (
    <div className="size-full">
      <ProfileSettingsHeading title={t("calendar_feed.title")} description={t("calendar_feed.profile_description")} />
      <div className="mt-7">
        <ProfileCalendarFeedsRoot />
      </div>
    </div>
  );
});
