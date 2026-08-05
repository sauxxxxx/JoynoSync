export const SYSTEM_APP_NAME = "Joynosync";
export const SYSTEM_LOGO_PATH = "/assets/joynosync-logo.png";

const LEGACY_APP_LABELS = new Set(["joyno", "joyno crm", "crm workspace"]);

export function normalizeSystemAppLabel(value) {
  const label = String(value || "").trim();
  if (!label) {
    return SYSTEM_APP_NAME;
  }
  return LEGACY_APP_LABELS.has(label.toLowerCase()) ? SYSTEM_APP_NAME : label;
}

export function resolveBrandLogoUrl(value) {
  const logoUrl = String(value || "").trim();
  return logoUrl || SYSTEM_LOGO_PATH;
}
