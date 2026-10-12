/**
 * Settings is split in tabs. Which tab a URL points at: its #hash (the old
 * section anchors #quickbooks, #invoicing and #cost-rates open theirs) or
 * Intuit's return to /settings?qbo=...
 */
export type SettingsTab = "general" | "pay" | "costs" | "invoicing" | "quickbooks";

export const SETTINGS_TABS: Array<{ key: SettingsTab; label: string }> = [
  { key: "general", label: "General" },
  { key: "pay", label: "Pay rates" },
  { key: "costs", label: "Costs" },
  { key: "invoicing", label: "Invoicing" },
  { key: "quickbooks", label: "QuickBooks" },
];

const ALIASES: Record<string, SettingsTab> = { "cost-rates": "costs", rates: "pay" };

export function tabFromLocation(hash: string, search: string): SettingsTab | null {
  const h = hash.replace(/^#/, "");
  if (SETTINGS_TABS.some((t) => t.key === h)) return h as SettingsTab;
  if (Object.hasOwn(ALIASES, h)) return ALIASES[h];
  if (new URLSearchParams(search).has("qbo")) return "quickbooks";
  return null;
}
