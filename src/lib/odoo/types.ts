/** Pure types + helpers used by both server and client. NO Node imports. */

export interface SessionUser {
  id: number;
  login: string;
  name: string;
  partnerId: number;
  isAdmin: boolean;
  groups: string[];
}

export interface SessionPayload {
  session: string;
  user: SessionUser;
}

export function deriveRole(groups: string[]): {
  isManager: boolean;
  isOffice: boolean;
  isDesigner: boolean;
  isPainter: boolean;
  isCnc: boolean;
  isInstaller: boolean;
} {
  // Odoo's res.groups full_name comes through as "<Category> / <Group name>"
  // with spaces around the slash — but the group *name* itself can contain
  // its own " / " (e.g. "CNC / Router", "Office / Administracion"), so the
  // full string can have three (or more) " / "-separated segments even
  // though there are only two logical parts: category, then name. We only
  // consider groups inside the Indigo Decors category (so a "Sales /
  // Manager" never matches our Indigo Manager), and strip off just that
  // leading category segment — everything up to the *first* slash — rather
  // than keeping only the text after the *last* slash, so a group name that
  // itself contains a slash survives intact for the has(...) checks below.
  const indigoGroups = groups
    .filter((g) => g.startsWith("Indigo Decors"))
    .map((g) => {
      const idx = g.indexOf("/");
      return idx >= 0 ? g.slice(idx + 1).trim() : g.trim();
    });
  const has = (name: string) => indigoGroups.includes(name);
  return {
    isManager: has("Manager"),
    isOffice: has("Office / Administracion") || has("Office"),
    isDesigner: has("Disenador") || has("Designer"),
    isPainter: has("Pintor"),
    isCnc: has("CNC / Router") || has("CNC"),
    isInstaller:
      has("Installer (internal)") ||
      has("Contractor (portal)") ||
      has("Installer"),
  };
}
