import { invokeSupabaseFunction } from "./functions.js";

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

async function parseResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(text(payload?.error || response.statusText, "RingCentral request failed."));
  }
  return payload;
}

export async function fetchRingCentralIntegrationStatus() {
  const [statusResponse, setupResponse] = await Promise.all([
    invokeSupabaseFunction("ringcentral-subscription", { method: "GET" }),
    invokeSupabaseFunction("ringcentral-agent-mappings", { method: "GET" })
  ]);
  const [status, setup] = await Promise.all([
    parseResponse(statusResponse),
    parseResponse(setupResponse)
  ]);
  const serviceExtension = (setup.providerExtensions || []).find(
    (entry) => text(entry?.id) === text(status.extensionRef)
  ) || {};
  return {
    ...status,
    ...setup,
    extensionNumber: text(status.extensionNumber || serviceExtension.extensionNumber),
    serviceUser: text(status.serviceUser || serviceExtension.displayName),
    accountName: text(status.accountName || serviceExtension.accountName)
  };
}

export async function runRingCentralIntegrationAction(action, payload = {}) {
  const response = await invokeSupabaseFunction("ringcentral-subscription", {
    method: "POST",
    body: { ...payload, action: text(action, "connect") }
  });
  return parseResponse(response);
}

export async function runRingCentralSetupAction(action, payload = {}) {
  const response = await invokeSupabaseFunction("ringcentral-agent-mappings", {
    method: "POST",
    body: { ...payload, action: text(action) }
  });
  return parseResponse(response);
}
