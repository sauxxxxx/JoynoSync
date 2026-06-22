import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { supabaseConfig } from "./config.js";

const REQUIRED_KEYS = ["url", "anonKey"];

let cachedServices = null;

function hasValidConfigValue(value) {
  return typeof value === "string" && value.length > 0 && value !== "REPLACE_ME";
}

export function isSupabaseConfigured() {
  return REQUIRED_KEYS.every((key) => hasValidConfigValue(supabaseConfig[key]));
}

export function initSupabase() {
  if (cachedServices) {
    return cachedServices;
  }

  if (!isSupabaseConfigured()) {
    cachedServices = { configured: false };
    return cachedServices;
  }

  const client = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce"
    }
  });

  cachedServices = {
    configured: true,
    client
  };

  return cachedServices;
}
