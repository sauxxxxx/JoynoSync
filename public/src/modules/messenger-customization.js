const MESSENGER_THEME_OPTIONS = [
  {
    key: "default",
    label: "Default",
    summary: "JoynoSync charcoal.",
    previewClass: "is-default"
  },
  {
    key: "soft",
    label: "Warm",
    summary: "Muted clay accent.",
    previewClass: "is-soft"
  },
  {
    key: "midnight",
    label: "Ink",
    summary: "Deep graphite accent.",
    previewClass: "is-midnight"
  },
  {
    key: "mint",
    label: "Sage",
    summary: "Calm green accent.",
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

function normalizeParticipantName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function getMessengerNicknameForSender(
  conversationKeyValue,
  senderNameValue,
  canonicalSenderNameValue,
  nicknamesByConversationKey = {}
) {
  const conversationKey = String(conversationKeyValue || "").trim();
  const nicknames = nicknamesByConversationKey?.[conversationKey];
  if (!nicknames || typeof nicknames !== "object") {
    return "";
  }

  const canonicalName = normalizeParticipantName(canonicalSenderNameValue);
  const senderName = normalizeParticipantName(senderNameValue);
  const entries = Object.entries(nicknames)
    .map(([participantName, nickname]) => ({
      participantName: normalizeParticipantName(participantName),
      nickname: String(nickname || "").trim()
    }))
    .filter((entry) => entry.participantName && entry.nickname);

  const exactMatch = entries.find(
    (entry) => entry.participantName === canonicalName || entry.participantName === senderName
  );
  if (exactMatch) {
    return exactMatch.nickname;
  }

  if (!senderName) {
    return "";
  }
  const shortNameMatches = entries.filter((entry) => entry.participantName.startsWith(`${senderName} `));
  return shortNameMatches.length === 1 ? shortNameMatches[0].nickname : "";
}

export { MESSENGER_THEME_OPTIONS };
