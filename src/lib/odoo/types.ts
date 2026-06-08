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
  // Odoo's res.groups full_name comes through as "<Category> / <Group>"
  // with spaces around the slash. We compare on the trailing group name
  // (everything after the last slash), and only inside the Indigo Decors
  // category — so a "Sales / Manager" never matches our Indigo Manager.
  const indigoGroups = groups
    .filter((g) => g.startsWith("Indigo Decors"))
    .map((g) => {
      const idx = g.lastIndexOf("/");
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
