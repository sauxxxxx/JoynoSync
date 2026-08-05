const MESSENGER_THEME_OPTIONS = [
  {
    key: "default",
    label: "Default",
    summary: "Clean blue and white chat surfaces.",
    previewClass: "is-default"
  },
  {
    key: "soft",
    label: "Soft",
    summary: "Gentle surfaces with a calmer accent.",
    previewClass: "is-soft"
  },
  {
    key: "midnight",
    label: "Midnight",
    summary: "Dark pane with brighter accent bubbles.",
    previewClass: "is-midnight"
  },
  {
    key: "mint",
    label: "Mint",
    summary: "Fresh green accent with airy surfaces.",
    previewClass: "is-mint"
  }
];

export function normalizeMessengerThemeKey(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return MESSENGER_THEME_OPTIONS.some((option) => option.key === normalized) ? normalized : "default";
}

export function getMessengerThemeOption(value) {
  const key = normalizeMessengerThemeKey(value);
  return MESSENGER_THEME_OPTIONS.find((option) => option.key === key) || MESSENGER_THEME_OPTIONS[0];
}

export function getMessengerThemeLabel(value) {
  return getMessengerThemeOption(value).label;
}

export function getMessengerThemeSummary(value) {
  return getMessengerThemeOption(value).summary;
}

export { MESSENGER_THEME_OPTIONS };
