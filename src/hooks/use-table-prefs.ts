"use client";

import { useState, useEffect } from "react";

/**
 * Per-user (localStorage) column visibility, ordered by the catalog. `allKeys`
 * is the catalog order; the returned `colKeys` is always a subset in that order.
 */
export function useColumnPrefs(storageKey: string, allKeys: string[], defaultKeys: string[]) {
  const [colKeys, setColKeys] = useState<string[]>(defaultKeys);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr) && arr.length) {
          setColKeys(allKeys.filter((k) => arr.includes(k)));
        }
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  function toggle(key: string) {
    setColKeys((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      const ordered = allKeys.filter((k) => next.includes(k));
      try {
        localStorage.setItem(storageKey, JSON.stringify(ordered));
      } catch {
        /* ignore */
      }
      return ordered;
    });
  }

  return { colKeys, toggle };
}

export type SortState<K extends string = string> = { key: K; dir: "asc" | "desc" };

/** Sortable-header state: click the active column to flip direction. */
export function useSort<K extends string>(defaultKey: K, defaultDir: "asc" | "desc" = "asc") {
  const [sort, setSort] = useState<SortState<K>>({ key: defaultKey, dir: defaultDir });
  function toggleSort(key: K) {
    setSort((p) => (p.key === key ? { key, dir: p.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }
  return { sort, toggleSort };
}

/** Stable sort of `rows` by a value selector + direction. */
export function sortRows<T>(rows: T[], sortVal: (r: T) => string | number, dir: "asc" | "desc") {
  const m = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortVal(a);
    const vb = sortVal(b);
    if (va < vb) return -1 * m;
    if (va > vb) return 1 * m;
    return 0;
  });
}
