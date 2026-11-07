/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// Hilfsfunktionen für verschachtelte Seiten (parent) – gemeinsam für Projekt-Seiten und Workspace-Wiki.

type TTreePage = { id?: string | undefined; parent?: string | null };

/**
 * IDs der direkten Unterseiten von parentId innerhalb von pageIds (Reihenfolge bleibt erhalten).
 */
export const getChildIdsWithin = <T extends TTreePage>(
  pages: Record<string, T>,
  pageIds: string[],
  parentId: string
): string[] => pageIds.filter((id) => pages[id]?.parent === parentId);

/**
 * Wurzeln innerhalb einer (gefilterten) Menge: Seiten, deren Elternseite nicht in der Menge enthalten ist.
 * Dadurch erscheinen z. B. private Unterseiten öffentlicher Seiten im Tab "Privat" auf oberster Ebene.
 */
export const getRootIdsWithin = <T extends TTreePage>(pages: Record<string, T>, pageIds: string[]): string[] => {
  const idSet = new Set(pageIds);
  return pageIds.filter((id) => {
    const parent = pages[id]?.parent;
    return !parent || !idSet.has(parent);
  });
};

/**
 * Vorfahren einer Seite, von der obersten Ebene bis zur direkten Elternseite.
 * Bricht bei fehlenden (nicht geladenen/nicht sichtbaren) Seiten oder Zyklen ab.
 */
export const getAncestorIds = <T extends TTreePage>(pages: Record<string, T>, pageId: string): string[] => {
  const ancestors: string[] = [];
  const visited = new Set<string>([pageId]);
  let current = pages[pageId]?.parent;
  while (current && pages[current] && !visited.has(current)) {
    ancestors.unshift(current);
    visited.add(current);
    current = pages[current]?.parent;
  }
  return ancestors;
};

/**
 * Alle Nachfahren einer Seite (ohne die Seite selbst).
 */
export const getDescendantIds = <T extends TTreePage>(pages: Record<string, T>, pageId: string): string[] => {
  const childrenByParent = new Map<string, string[]>();
  Object.entries(pages).forEach(([id, page]) => {
    if (!page?.parent) return;
    const list = childrenByParent.get(page.parent) ?? [];
    list.push(id);
    childrenByParent.set(page.parent, list);
  });
  const result: string[] = [];
  const visited = new Set<string>([pageId]);
  const stack = [...(childrenByParent.get(pageId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (visited.has(id)) continue;
    visited.add(id);
    result.push(id);
    stack.push(...(childrenByParent.get(id) ?? []));
  }
  return result;
};

// ---------------------------------------------------------------------------
// Reihenfolge (sort_order) – gleiche Konstanten wie im Backend (plane/utils/page_tree.py)
// ---------------------------------------------------------------------------

export const PAGE_SORT_ORDER_STEP = 10000;
const PAGE_DEFAULT_SORT_ORDER = 65535;
// kleiner als dieser Abstand -> kein sinnvoller Mittelwert mehr, Ebene neu nummerieren
const MIN_SORT_ORDER_GAP = 0.001;

type TSortablePage = TTreePage & { sort_order?: number | undefined };

const sortOrderOf = (page: TSortablePage | undefined) => page?.sort_order ?? PAGE_DEFAULT_SORT_ORDER;

/**
 * sort_order für das Ende einer Ebene (größter Wert der Geschwister + Schritt).
 * @param isInScope optional: nur Seiten desselben Bereichs (Projekt/Wiki) berücksichtigen
 */
export const getEndSortOrder = <T extends TSortablePage>(
  pages: Record<string, T>,
  parentId: string | null,
  excludeId: string,
  isInScope: (page: T) => boolean = () => true
): number => {
  const values = Object.entries(pages)
    .filter(([id, page]) => id !== excludeId && (page?.parent ?? null) === parentId && isInScope(page))
    .map(([, page]) => sortOrderOf(page));
  return values.length > 0 ? Math.max(...values) + PAGE_SORT_ORDER_STEP : PAGE_DEFAULT_SORT_ORDER;
};

export type TPageDropPosition = {
  parent: string | null;
  // für die sofortige Anzeige (bei order nur Platzhalter)
  sort_order: number;
  // komplette neue Reihenfolge der Ziel-Ebene, wenn kein Mittelwert möglich ist
  order?: string[];
};

/**
 * Neue Position beim Ablegen zwischen zwei Seiten (Plane-Muster wie bei Projekten/Labels):
 * Mittelwert der Nachbarn, am Anfang erster Wert − Schritt, am Ende letzter Wert + Schritt.
 * Liegen die Nachbarn gleichauf (z. B. alle Bestandsseiten mit 65535), wird stattdessen die
 * komplette Reihenfolge der Ebene mitgeschickt und vom Backend neu nummeriert.
 * @param siblingIds angezeigte Geschwister der Ziel-Ebene in Anzeige-Reihenfolge (ohne die verschobene Seite)
 * @param insertIndex Einfügeposition innerhalb von siblingIds
 */
export const getDropPosition = <T extends TSortablePage>(
  pages: Record<string, T>,
  movedId: string,
  parentId: string | null,
  siblingIds: string[],
  insertIndex: number
): TPageDropPosition => {
  const ids = siblingIds.filter((id) => id !== movedId);
  const index = Math.max(0, Math.min(insertIndex, ids.length));
  const prev = index > 0 ? sortOrderOf(pages[ids[index - 1]]) : undefined;
  const next = index < ids.length ? sortOrderOf(pages[ids[index]]) : undefined;

  if (prev === undefined && next === undefined) return { parent: parentId, sort_order: PAGE_DEFAULT_SORT_ORDER };
  if (prev === undefined) return { parent: parentId, sort_order: (next as number) - PAGE_SORT_ORDER_STEP };
  if (next === undefined) return { parent: parentId, sort_order: prev + PAGE_SORT_ORDER_STEP };
  if (next - prev > MIN_SORT_ORDER_GAP) return { parent: parentId, sort_order: (prev + next) / 2 };

  const order = [...ids.slice(0, index), movedId, ...ids.slice(index)];
  return { parent: parentId, sort_order: (index + 1) * PAGE_SORT_ORDER_STEP, order };
};
