import {
  getGoogleAccessToken,
  getGmailMessage,
  isGoogleReconnectRequiredError,
  listGmailMessages,
  normalizeGoogleReconnectErrorMessage,
  resolveEmailIntegration
} from "../_shared/domain.ts";
import { handleCors, jsonResponse, methodNotAllowed, requireCaller } from "../_shared/runtime.ts";

const MESSAGE_FOLDER_CONFIG: Record<string, { labelIds?: string[]; q?: string }> = {
  inbox: { labelIds: ["INBOX"] },
  unread: { labelIds: ["INBOX", "UNREAD"] },
  sent: { labelIds: ["SENT"] },
  spam: { labelIds: ["SPAM"] },
  trash: { labelIds: ["TRASH"] }
};

function normalizeFolderId(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["inbox", "unread", "sent", "drafts", "spam", "trash"].includes(normalized)) {
    return normalized;
  }
  return "inbox";
}

function normalizeLimit(value: unknown, fallback = 25) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(1, Math.min(Math.round(parsed), 50));
}

function parseHeaderMap(headers: unknown) {
  const headerMap = new Map<string, string>();
  if (!Array.isArray(headers)) {
    return headerMap;
  }
  headers.forEach((entry) => {
    const name = String((entry as { name?: string })?.name || "").trim().toLowerCase();
    if (!name) {
      return;
    }
    headerMap.set(name, String((entry as { value?: string })?.value || "").trim());
  });
  return headerMap;
}

function decodeBase64Url(value: unknown) {
  const encoded = String(value || "").trim();
  if (!encoded) {
    return "";
  }
  try {
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

function stripHtmlToText(value: string) {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type GmailMessagePart = {
  mimeType?: string;
  filename?: string;
  body?: {
    data?: string;
    size?: number;
    attachmentId?: string;
  };
  parts?: GmailMessagePart[];
};

function extractPayloadContent(part: GmailMessagePart | null | undefined, target: {
  textParts: string[];
  htmlParts: string[];
  attachments: Array<{ id: string; name: string; mimeType: string; size: number }>;
}) {
  if (!part || typeof part !== "object") {
    return;
  }
  const mimeType = String(part.mimeType || "").trim().toLowerCase();
  const fileName = String(part.filename || "").trim();
  const bodyData = decodeBase64Url(part.body?.data);
  if (mimeType === "text/plain" && bodyData) {
    target.textParts.push(bodyData);
  } else if (mimeType === "text/html" && bodyData) {
    target.htmlParts.push(bodyData);
  }
  if (fileName) {
    target.attachments.push({
      id: String(part.body?.attachmentId || "").trim(),
      name: fileName,
      mimeType: String(part.mimeType || "application/octet-stream").trim() || "application/octet-stream",
      size: Number(part.body?.size || 0) || 0
    });
  }
  if (Array.isArray(part.parts)) {
    part.parts.forEach((childPart) => extractPayloadContent(childPart, target));
  }
}

function resolveSenderLabel(fromHeader: string) {
  const raw = String(fromHeader || "").trim();
  if (!raw) {
    return "Unknown sender";
  }
  const angleMatch = raw.match(/^(.*)<([^>]+)>$/);
  if (angleMatch) {
    const displayName = String(angleMatch[1] || "").replaceAll("\"", "").trim();
    if (displayName) {
      return displayName;
    }
    return String(angleMatch[2] || "").trim() || raw;
  }
  return raw;
}

function mapGmailMessageToMailboxRecord(
  entry: Record<string, unknown>,
  fallbackFolderId = "inbox"
) {
  const payload = entry.payload && typeof entry.payload === "object" ? (entry.payload as GmailMessagePart) : null;
  const headerMap = parseHeaderMap((payload as { headers?: unknown[] } | null)?.headers);
  const extracted = {
    textParts: [] as string[],
    htmlParts: [] as string[],
    attachments: [] as Array<{ id: string; name: string; mimeType: string; size: number }>
  };
  extractPayloadContent(payload, extracted);
  const htmlBody = extracted.htmlParts.join("\n\n").trim();
  const textBody = extracted.textParts.join("\n\n").trim() || stripHtmlToText(htmlBody);
  const labelIds = Array.isArray(entry.labelIds) ? entry.labelIds.map((label) => String(label || "").trim().toUpperCase()) : [];
  const isUnread = labelIds.includes("UNREAD");
  const mappedFolderId = fallbackFolderId === "inbox" && isUnread ? "unread" : fallbackFolderId;
  const internalDate = String(entry.internalDate || "").trim();
  const createdAt = internalDate ? new Date(Number(internalDate)).toISOString() : new Date().toISOString();
  const senderAddress = String(headerMap.get("from") || "").trim();
  const recipient = String(headerMap.get("to") || "").trim();
  return {
    id: String(entry.id || "").trim(),
    threadId: String(entry.threadId || "").trim(),
    targetType: "",
    targetId: "",
    sender: resolveSenderLabel(senderAddress),
    senderAddress,
    text: textBody,
    html: htmlBody,
    messageType: "Announcement",
    important: false,
    linkedType: "",
    linkedLabel: "",
    commMode: "email",
    emailFolder: mappedFolderId,
    emailSubject: String(headerMap.get("subject") || "").trim() || "No subject",
    emailTo: recipient,
    emailCc: String(headerMap.get("cc") || "").trim(),
    emailBcc: String(headerMap.get("bcc") || "").trim(),
    createdAt,
    attachments: extracted.attachments,
    emailSnippet: String(entry.snippet || "").trim(),
    isGmailMailbox: true
  };
}

async function fetchFolderCount(accessToken: string, folderId: string) {
  const normalizedFolderId = normalizeFolderId(folderId);
  if (normalizedFolderId === "drafts") {
    return 0;
  }
  const folderConfig = MESSAGE_FOLDER_CONFIG[normalizedFolderId] || MESSAGE_FOLDER_CONFIG.inbox;
  const payload = await listGmailMessages({
    accessToken,
    labelIds: folderConfig.labelIds,
    q: folderConfig.q,
    maxResults: 1
  });
  return Math.max(0, Number(payload.resultSizeEstimate || 0) || 0);
}

async function fetchFolderMessages(accessToken: string, folderId: string, limit: number) {
  const normalizedFolderId = normalizeFolderId(folderId);
  if (normalizedFolderId === "drafts") {
    return [];
  }
  const folderConfig = MESSAGE_FOLDER_CONFIG[normalizedFolderId] || MESSAGE_FOLDER_CONFIG.inbox;
  const listPayload = await listGmailMessages({
    accessToken,
    labelIds: folderConfig.labelIds,
    q: folderConfig.q,
    maxResults: limit
  });
  const messageRefs = Array.isArray(listPayload.messages)
    ? listPayload.messages
        .map((entry) => ({
          id: String((entry as { id?: string })?.id || "").trim(),
          threadId: String((entry as { threadId?: string })?.threadId || "").trim()
        }))
        .filter((entry) => entry.id)
    : [];
  const messages = await Promise.all(
    messageRefs.map(async (entry) => {
      const payload = await getGmailMessage({
        accessToken,
        messageId: entry.id,
        format: "full"
      });
      return mapGmailMessageToMailboxRecord(
        {
          ...payload,
          id: entry.id,
          threadId: entry.threadId || String(payload.threadId || "").trim()
        },
        normalizedFolderId
      );
    })
  );
  return messages;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) {
    return corsResponse;
  }
  if (req.method !== "GET") {
    return methodNotAllowed(req, ["GET"]);
  }

  const auth = await requireCaller(req);
  if (auth.response) {
    return auth.response;
  }

  try {
    const url = new URL(req.url);
    const workspaceId = String(url.searchParams.get("workspaceId") || "").trim();
    const userId = String(url.searchParams.get("userId") || auth.caller?.uid || "").trim();
    const integrationId = String(url.searchParams.get("integrationId") || "").trim();
    const folderId = normalizeFolderId(url.searchParams.get("folder"));
    const limit = normalizeLimit(url.searchParams.get("limit"), 25);

    const integration = await resolveEmailIntegration({
      workspaceId,
      userId,
      integrationId
    });
    const accessToken = await getGoogleAccessToken(integration.refreshToken);
    const [inboxCount, unreadCount, sentCount, spamCount, trashCount, items] = await Promise.all([
      fetchFolderCount(accessToken, "inbox"),
      fetchFolderCount(accessToken, "unread"),
      fetchFolderCount(accessToken, "sent"),
      fetchFolderCount(accessToken, "spam"),
      fetchFolderCount(accessToken, "trash"),
      fetchFolderMessages(accessToken, folderId, limit)
    ]);

    return jsonResponse(req, 200, {
      ok: true,
      provider: "gmail",
      source: integration.source || "supabase",
      folder: folderId,
      counts: {
        inbox: inboxCount,
        unread: unreadCount,
        sent: sentCount,
        drafts: 0,
        spam: spamCount,
        trash: trashCount
      },
      items
    });
  } catch (error) {
    console.error("gmail-mailbox failed", error);
    const reconnectRequired = isGoogleReconnectRequiredError(error);
    return jsonResponse(req, reconnectRequired ? 401 : 500, {
      ok: false,
      error: normalizeGoogleReconnectErrorMessage(error),
      reconnectRequired
    });
  }
});
