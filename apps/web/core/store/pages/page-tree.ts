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
