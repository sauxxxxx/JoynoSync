export const supabaseConfig = {
  url: "https://ihrputhrxkrpyrgydsat.supabase.co",
  anonKey: "sb_publishable_ZwDQjjcd5SGFVb-Aqt4_Fg_9ioHdUOu",
  publicBaseUrl: "https://joynosync.web.app",
  functionsBaseUrl: "",
  smsComposeUrlTemplate: "sms:{number}?body={body}"
};

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function getPublicAppUrl() {
  const configured = normalizeBaseUrl(supabaseConfig.publicBaseUrl);
  if (configured) {
    return configured;
  }
  return normalizeBaseUrl(`${window.location.origin}${window.location.pathname}`);
}
