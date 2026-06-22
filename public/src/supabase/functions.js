import { supabaseConfig } from "./config.js";
import { initSupabase } from "./init.js";

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

async function getCurrentAccessToken() {
  const services = initSupabase();
  if (!services.configured) {
    return "";
  }
  const { data } = await services.client.auth.getSession();
  return String(data?.session?.access_token || "").trim();
}

export function getSupabaseFunctionsBaseUrl() {
  const configured = normalizeUrl(supabaseConfig.functionsBaseUrl);
  if (configured) {
    return configured;
  }
  return `${normalizeUrl(supabaseConfig.url)}/functions/v1`;
}

export function getSupabaseFunctionUrl(name, query = {}) {
  const url = new URL(`${getSupabaseFunctionsBaseUrl()}/${String(name || "").trim()}`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    url.searchParams.set(key, String(value));
  });
  return url;
}

export async function invokeSupabaseFunction(name, options = {}) {
  const {
    method = "POST",
    query = {},
    body,
    accessToken = "",
    headers = {},
    accept = "application/json"
  } = options;

  const url = getSupabaseFunctionUrl(name, query);
  const requestHeaders = new Headers(headers);
  requestHeaders.set("apikey", String(supabaseConfig.anonKey || "").trim());
  if (accept) {
    requestHeaders.set("Accept", accept);
  }

  const token = String(accessToken || "").trim() || (await getCurrentAccessToken());
  if (token) {
    requestHeaders.set("Authorization", `Bearer ${token}`);
  }

  let requestBody;
  if (body !== undefined) {
    requestHeaders.set("Content-Type", "application/json");
    requestBody = JSON.stringify(body);
  }

  return fetch(url.toString(), {
    method,
    headers: requestHeaders,
    body: requestBody
  });
}
