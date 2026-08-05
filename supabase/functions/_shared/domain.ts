import { createServiceClient, getEnv, getRequiredEnv } from "./runtime.ts";
import { decryptSecret, encryptSecret, randomHex, stringToBase64Url, toMimeBase64 } from "./security.ts";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GMAIL_API_BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export function normalizeInviteStatus(value: string) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "Pending Invite";
  }
  if (normalized === "active") {
    return "Active";
  }
  if (normalized === "inactive") {
    return "Inactive";
  }
  if (normalized === "pending invite" || normalized === "pending_invite" || normalized === "invited") {
    return "Pending Invite";
  }
  return String(value || "Pending Invite").trim() || "Pending Invite";
}

export function mapInviteRow(row: Record<string, unknown> | null) {
  if (!row || typeof row !== "object") {
    return null;
  }
  const status = normalizeInviteStatus(String(row.status || "Pending Invite"));
  return {
    inviteId: String(row.invite_id || "").trim(),
    workspaceId: String(row.workspace_id || "").trim(),
    workspace: String(row.workspace || "Workspace").trim() || "Workspace",
    email: String(row.email || "").trim().toLowerCase(),
    name: String(row.name || "").trim(),
    role: String(row.role || "Member").trim() || "Member",
    team: String(row.team || "General").trim() || "General",
    invitedBy: String(row.invited_by || "Workspace admin").trim() || "Workspace admin",
    token: String(row.token || "").trim(),
    status,
    active: row.active !== false && status === "Pending Invite",
    updatedAt: String(row.updated_at || row.created_at || "").trim()
  };
}

export function normalizeInvitePayload(payload: Record<string, unknown> = {}) {
  const inviteId = String(payload.inviteId || payload.id || "").trim();
  if (!inviteId) {
    return null;
  }
  const status = normalizeInviteStatus(String(payload.status || "Pending Invite"));
  return {
    inviteId,
    workspaceId: String(payload.workspaceId || "").trim(),
    workspace: String(payload.workspace || "Workspace").trim() || "Workspace",
    email: String(payload.email || "").trim().toLowerCase(),
    name: String(payload.name || "").trim(),
    role: String(payload.role || "Member").trim() || "Member",
    team: String(payload.team || "General").trim() || "General",
    invitedBy: String(payload.invitedBy || "Workspace admin").trim() || "Workspace admin",
    token: String(payload.token || payload.inviteToken || "").trim(),
    status,
    active: payload.active !== false && status === "Pending Invite"
  };
}

export async function findPublicInviteRecord(options: { inviteId?: string; token?: string }) {
  const client = createServiceClient();
  const inviteId = String(options.inviteId || "").trim();
  if (inviteId) {
    const { data, error } = await client.from("public_invites").select("*").eq("invite_id", inviteId).maybeSingle();
    if (error) {
      throw error;
    }
    const invite = mapInviteRow(data as Record<string, unknown> | null);
    if (invite) {
      return invite;
    }
  }

  const token = String(options.token || "").trim();
  if (token) {
    const { data, error } = await client
      .from("public_invites")
      .select("*")
      .eq("token", token)
      .eq("active", true)
      .limit(1)
      .maybeSingle();
    if (error) {
      throw error;
    }
    return mapInviteRow(data as Record<string, unknown> | null);
  }

  return null;
}

export async function savePublicInviteRecord(payload: Record<string, unknown>) {
  const invite = normalizeInvitePayload(payload);
  if (!invite) {
    throw new Error("Invite id is required");
  }

  const client = createServiceClient();
  const now = new Date().toISOString();
  const row = {
    invite_id: invite.inviteId,
    workspace_id: invite.workspaceId || null,
    workspace: invite.workspace,
    email: invite.email || null,
    name: invite.name || "",
    role: invite.role,
    team: invite.team,
    invited_by: invite.invitedBy,
    token: invite.token || null,
    status: invite.status,
    active: Boolean(invite.active),
    updated_at: now,
    created_at: now
  };

  const { error } = await client.from("public_invites").upsert(row, { onConflict: "invite_id" });
  if (error) {
    throw error;
  }

  return invite;
}

export async function removePublicInviteRecord(inviteId: string) {
  const normalizedId = String(inviteId || "").trim();
  if (!normalizedId) {
    throw new Error("Invite id is required");
  }
  const client = createServiceClient();
  const { error } = await client.from("public_invites").delete().eq("invite_id", normalizedId);
  if (error) {
    throw error;
  }
}

function mapEmailIntegrationRow(row: Record<string, unknown> | null, source = "supabase") {
  if (!row || typeof row !== "object") {
    return null;
  }
  return {
    integrationId: String(row.integration_id || "").trim(),
    provider: String(row.provider || "gmail").trim() || "gmail",
    workspaceId: String(row.workspace_id || "").trim(),
    userId: String(row.user_id || "").trim(),
    email: String(row.email || "").trim(),
    connected: row.connected !== false,
    updatedAt: String(row.updated_at || row.created_at || "").trim(),
    refreshTokenEncrypted: String(row.refresh_token_encrypted || "").trim(),
    source
  };
}

export async function findEmailIntegration(options: { workspaceId?: string; userId?: string; integrationId?: string }) {
  const client = createServiceClient();
  const integrationId = String(options.integrationId || "").trim();
  if (integrationId) {
    const { data, error } = await client
      .from("email_integrations")
      .select("*")
      .eq("integration_id", integrationId)
      .maybeSingle();
    if (error) {
      throw error;
    }
    const integration = mapEmailIntegrationRow(data as Record<string, unknown> | null);
    if (integration) {
      return integration;
    }
  }

  const workspaceId = String(options.workspaceId || "").trim();
  const userId = String(options.userId || "").trim();
  if (workspaceId && userId) {
    const { data, error } = await client
      .from("email_integrations")
      .select("*")
      .eq("provider", "gmail")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .eq("connected", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw error;
    }
    const integration = mapEmailIntegrationRow(data as Record<string, unknown> | null);
    if (integration) {
      return integration;
    }
  }

  const envToken = getEnv("GOOGLE_OAUTH_REFRESH_TOKEN");
  if (envToken) {
    return {
      integrationId: "env_gmail",
      provider: "gmail",
      workspaceId,
      userId,
      email: String(getEnv("GOOGLE_OAUTH_SENDER_EMAIL", "") || "").trim(),
      connected: true,
      updatedAt: "",
      refreshTokenEncrypted: envToken,
      source: "env"
    };
  }

  return null;
}

export async function upsertEmailIntegration(payload: {
  integrationId: string;
  workspaceId?: string;
  userId?: string;
  email?: string;
  refreshToken: string;
  scope?: string;
}) {
  const client = createServiceClient();
  const now = new Date().toISOString();
  const encryptedRefreshToken = await encryptSecret(payload.refreshToken);
  const row = {
    integration_id: String(payload.integrationId || "").trim(),
    provider: "gmail",
    workspace_id: String(payload.workspaceId || "").trim() || null,
    user_id: String(payload.userId || "").trim() || null,
    email: String(payload.email || "").trim() || null,
    refresh_token_encrypted: encryptedRefreshToken,
    connected: true,
    scope: String(payload.scope || "").trim() || null,
    updated_at: now,
    created_at: now
  };

  const { error } = await client.from("email_integrations").upsert(row, { onConflict: "integration_id" });
  if (error) {
    throw error;
  }
}

export async function resolveEmailIntegration(options: {
  workspaceId?: string;
  userId?: string;
  integrationId?: string;
  refreshToken?: string;
}) {
  const explicitRefreshToken = String(options.refreshToken || "").trim();
  if (explicitRefreshToken) {
    return {
      refreshToken: explicitRefreshToken,
      fromEmail: null,
      integrationId: null,
      source: "inline"
    };
  }

  const integration = await findEmailIntegration(options);
  if (!integration) {
    throw new Error("No Gmail integration found. Connect Google first or provide refreshToken.");
  }

  return {
    refreshToken:
      integration.source === "env"
        ? String(integration.refreshTokenEncrypted || "").trim()
        : await decryptSecret(integration.refreshTokenEncrypted),
    fromEmail: integration.email || null,
    integrationId: integration.integrationId || null,
    source: integration.source || "supabase"
  };
}

export async function exchangeGoogleToken(payload: Record<string, string>) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(payload)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(json.error_description || json.error || `Google token exchange failed (${response.status})`));
  }
  return json as Record<string, string>;
}

export function isGoogleReconnectRequiredError(error: unknown) {
  const text = String(error instanceof Error ? error.message : error || "")
    .trim()
    .toLowerCase();
  if (!text) {
    return false;
  }
  return (
    text.includes("invalid_grant") ||
    text.includes("token has been expired or revoked") ||
    text.includes("insufficient authentication scopes") ||
    text.includes("gmail connection has expired") ||
    text.includes("reconnect gmail")
  );
}

export function normalizeGoogleReconnectErrorMessage(error: unknown) {
  if (isGoogleReconnectRequiredError(error)) {
    if (String(error instanceof Error ? error.message : error || "").toLowerCase().includes("insufficient authentication scopes")) {
      return "Your Gmail connection is missing inbox permissions. Reconnect Gmail to grant mailbox access.";
    }
    return "Your Gmail connection has expired or was revoked. Reconnect Gmail to continue.";
  }
  return String(error instanceof Error ? error.message : error || "Unknown Gmail error").trim() || "Unknown Gmail error";
}

export async function getGoogleAccessToken(refreshToken: string) {
  try {
    const tokenResponse = await exchangeGoogleToken({
      client_id: getRequiredEnv("GOOGLE_OAUTH_CLIENT_ID"),
      client_secret: getRequiredEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    });
    return String(tokenResponse.access_token || "").trim();
  } catch (error) {
    throw new Error(normalizeGoogleReconnectErrorMessage(error));
  }
}

export async function fetchGoogleUser(accessToken: string) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(json.error_description || json.error || "Failed to fetch Google profile"));
  }
  return json as Record<string, string>;
}

export function buildRawMimeEmail({
  from,
  to,
  cc,
  bcc,
  subject,
  text,
  html
}: {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  html?: string;
}) {
  const plainText = String(text || "").trim();
  const htmlText = String(html || "").trim();
  if (htmlText) {
    const boundary = `joyno_${randomHex(12)}`;
    const headers = [
      `From: ${from}`,
      `To: ${to.join(", ")}`,
      ...(cc.length ? [`Cc: ${cc.join(", ")}`] : []),
      ...(bcc.length ? [`Bcc: ${bcc.join(", ")}`] : []),
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      toMimeBase64(plainText),
      "",
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      toMimeBase64(htmlText),
      "",
      `--${boundary}--`
    ];
    return stringToBase64Url(headers.join("\r\n"));
  }

  const headers = [
    `From: ${from}`,
    `To: ${to.join(", ")}`,
    ...(cc.length ? [`Cc: ${cc.join(", ")}`] : []),
    ...(bcc.length ? [`Bcc: ${bcc.join(", ")}`] : []),
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    plainText
  ];

  return stringToBase64Url(headers.join("\r\n"));
}

export async function sendGmailMessage(options: { accessToken: string; raw: string }) {
  const response = await fetch(GMAIL_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ raw: options.raw })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(json.error?.message || `Gmail send failed (${response.status})`));
  }
  return json as Record<string, string>;
}

export async function fetchGmailApi(
  accessToken: string,
  path: string,
  query: Record<string, string | number | boolean | string[] | undefined | null> = {},
  init: RequestInit = {}
) {
  const normalizedPath = String(path || "").trim().replace(/^\/+/, "");
  const url = new URL(`${GMAIL_API_BASE_URL}/${normalizedPath}`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    if (Array.isArray(value)) {
      value
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .forEach((item) => url.searchParams.append(key, item));
      return;
    }
    url.searchParams.set(key, String(value));
  });
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(init.headers || {})
    }
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(json.error?.message || json.error_description || `Gmail request failed (${response.status})`));
  }
  return json as Record<string, unknown>;
}

export async function listGmailMessages(options: {
  accessToken: string;
  labelIds?: string[];
  q?: string;
  maxResults?: number;
}) {
  const query: Record<string, string | number | string[]> = {};
  if (Array.isArray(options.labelIds) && options.labelIds.length) {
    query.labelIds = options.labelIds;
  }
  if (String(options.q || "").trim()) {
    query.q = String(options.q || "").trim();
  }
  if (Number.isFinite(Number(options.maxResults)) && Number(options.maxResults) > 0) {
    query.maxResults = Math.max(1, Math.min(Number(options.maxResults), 100));
  }
  return fetchGmailApi(options.accessToken, "messages", query);
}

export async function getGmailMessage(options: { accessToken: string; messageId: string; format?: string }) {
  const messageId = String(options.messageId || "").trim();
  if (!messageId) {
    throw new Error("Message id is required");
  }
  return fetchGmailApi(options.accessToken, `messages/${encodeURIComponent(messageId)}`, {
    format: String(options.format || "full").trim() || "full"
  });
}

export async function logCommunication(payload: {
  workspaceId?: string;
  userId?: string;
  channel: string;
  provider: string;
  direction?: string;
  to?: string[];
  from?: string | null;
  subject?: string | null;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  externalId?: string | null;
  status?: string | null;
  meta?: Record<string, unknown>;
}) {
  try {
    const client = createServiceClient();
    const { error } = await client.from("communication_logs").insert({
      workspace_id: String(payload.workspaceId || "").trim() || null,
      user_id: String(payload.userId || "").trim() || null,
      channel: payload.channel,
      provider: payload.provider,
      direction: payload.direction || "outbound",
      recipient_addresses: Array.isArray(payload.to) ? payload.to : [],
      sender_address: payload.from || null,
      subject: payload.subject || null,
      body: payload.body || null,
      entity_type: payload.entityType || null,
      entity_id: payload.entityId || null,
      external_id: payload.externalId || null,
      status: payload.status || "sent",
      meta: payload.meta || {}
    });
    if (error) {
      throw error;
    }
  } catch (error) {
    console.warn("logCommunication failed", error);
  }
}

export async function logActivity(payload: {
  workspaceId?: string;
  actorId?: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  summary?: string;
  meta?: Record<string, unknown>;
}) {
  try {
    const client = createServiceClient();
    const { error } = await client.from("activity_logs").insert({
      workspace_id: String(payload.workspaceId || "").trim() || null,
      actor_id: String(payload.actorId || "system").trim() || "system",
      action: payload.action,
      entity_type: payload.entityType || null,
      entity_id: payload.entityId || null,
      summary: String(payload.summary || "").trim(),
      meta: payload.meta || {}
    });
    if (error) {
      throw error;
    }
  } catch (error) {
    console.warn("logActivity failed", error);
  }
}
