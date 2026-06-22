export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function matchesSearch(values, query) {
  if (!query) {
    return true;
  }
  return values.join(" ").toLowerCase().includes(query.toLowerCase());
}

export function phoneDigitsOnly(value) {
  return String(value || "").replace(/\D+/g, "");
}

export function normalizeForMatch(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

export function normalizePhoneValue(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const hasPlusPrefix = raw.startsWith("+");
  const compact = raw.replace(/[^\d*#]/g, "");
  const base = `${hasPlusPrefix ? "+" : ""}${compact}`;
  return base.slice(0, 24);
}
