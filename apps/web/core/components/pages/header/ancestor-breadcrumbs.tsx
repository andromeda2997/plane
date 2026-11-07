/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { PageIcon } from "@plane/propel/icons";
import { Breadcrumbs } from "@plane/ui";
import { getPageName } from "@plane/utils";
// components
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { SwitcherIcon } from "@/components/common/switcher-label";
// store
import type { TPageInstance } from "@/store/pages/base-page";

/**
 * Breadcrumb-Einträge für die übergeordneten Seiten (oberste Ebene zuerst).
 * Gibt ein Array zurück, weil <Breadcrumbs> seine direkten Kinder zählt (Fragmente würden als ein Eintrag gelten).
 */
export const renderPageAncestorBreadcrumbs = (
  ancestorIds: string[],
  getPageById: (pageId: string) => TPageInstance | undefined
) =>
  ancestorIds
    .map((ancestorId) => getPageById(ancestorId))
    .filter((ancestor): ancestor is TPageInstance => !!ancestor?.id)
    .map((ancestor) => (
      <Breadcrumbs.Item
        key={`page-ancestor-${ancestor.id}`}
        component={
          <BreadcrumbLink
            label={getPageName(ancestor.name)}
            href={ancestor.getRedirectionLink()}
            icon={<SwitcherIcon logo_props={ancestor.logo_props} LabelIcon={PageIcon} size={16} />}
          />
        }
      />
    ));
