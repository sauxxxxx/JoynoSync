const UI_PREFS_KEY = "joyno_ui_prefs_v1";

export function createDefaultUiPrefs() {
  return {
    theme: "light",
    sidebarCollapsed: false,
    waitingCollapsed: false,
    commsContextCollapsed: false,
    messengerInfoOpen: true,
    messengerThemeByConversationKey: {},
    messengerNicknamesByConversationKey: {},
    calendarMiniCollapsed: false,
    calendarSideCollapsed: false,
    sidebarSectionCollapsed: {},
    sidebarNodeCollapsed: {}
  };
}

export function loadUiPrefs() {
  try {
    const raw = window.localStorage.getItem(UI_PREFS_KEY);
    if (!raw) {
      return createDefaultUiPrefs();
    }
    const parsed = JSON.parse(raw);
    const sectionCollapsed =
      parsed.sidebarSectionCollapsed && typeof parsed.sidebarSectionCollapsed === "object"
        ? parsed.sidebarSectionCollapsed
        : {};
    const nodeCollapsed =
      parsed.sidebarNodeCollapsed && typeof parsed.sidebarNodeCollapsed === "object"
        ? parsed.sidebarNodeCollapsed
        : {};
    return {
      theme: parsed.theme === "dark" ? "dark" : "light",
      sidebarCollapsed: Boolean(parsed.sidebarCollapsed),
      waitingCollapsed: Boolean(parsed.waitingCollapsed),
      commsContextCollapsed: Boolean(parsed.commsContextCollapsed),
      messengerInfoOpen: parsed.messengerInfoOpen === undefined ? true : Boolean(parsed.messengerInfoOpen),
      messengerThemeByConversationKey:
        parsed.messengerThemeByConversationKey && typeof parsed.messengerThemeByConversationKey === "object"
          ? parsed.messengerThemeByConversationKey
          : {},
      messengerNicknamesByConversationKey:
        parsed.messengerNicknamesByConversationKey && typeof parsed.messengerNicknamesByConversationKey === "object"
          ? parsed.messengerNicknamesByConversationKey
          : {},
      calendarMiniCollapsed: Boolean(parsed.calendarMiniCollapsed),
      calendarSideCollapsed: Boolean(parsed.calendarSideCollapsed),
      sidebarSectionCollapsed: sectionCollapsed,
      sidebarNodeCollapsed: nodeCollapsed
    };
  } catch {
    return createDefaultUiPrefs();
  }
}

export function saveUiPrefs(state) {
  window.localStorage.setItem(
    UI_PREFS_KEY,
    JSON.stringify({
      theme: state.uiTheme,
      sidebarCollapsed: state.sidebarCollapsed,
      waitingCollapsed: state.waitingCollapsed,
      commsContextCollapsed: state.commsContextCollapsed,
      messengerInfoOpen: state.messengerInfoOpen,
      messengerThemeByConversationKey: state.messengerThemeByConversationKey,
      messengerNicknamesByConversationKey: state.messengerNicknamesByConversationKey,
      calendarMiniCollapsed: state.calendarMiniCollapsed,
      calendarSideCollapsed: state.calendarSideCollapsed,
      sidebarSectionCollapsed: state.sidebarSectionCollapsed,
      sidebarNodeCollapsed: state.sidebarNodeCollapsed
    })
  );
}
