import {
  buildRawMimeEmail,
  getGoogleAccessToken,
  isGoogleReconnectRequiredError,
  logActivity,
  logCommunication,
  normalizeGoogleReconnectErrorMessage,
  resolveEmailIntegration,
  sendGmailMessage
} from "../_shared/domain.ts";
import { handleCors, jsonResponse, methodNotAllowed, requireCaller } from "../_shared/runtime.ts";

function parseRecipients(input: unknown) {
  if (Array.isArray(input)) {
    return input.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) {
    return corsResponse;
  }
  if (req.method !== "POST") {
    return methodNotAllowed(req, ["POST"]);
  }

  const auth = await requireCaller(req);
  if (auth.response) {
    return auth.response;
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const workspaceId = String(payload.workspaceId || "").trim();
    const userId = String(payload.userId || auth.caller?.uid || "").trim();
    const to = parseRecipients(payload.to);
    const cc = parseRecipients(payload.cc);
    const bcc = parseRecipients(payload.bcc);
    const subject = String(payload.subject || "").trim();
    const text = String(payload.text || payload.body || "").trim();
    const html = String(payload.html || "").trim();
    const fromName = String(payload.fromName || "").trim();
    const explicitFrom = String(payload.from || "").trim();

    if (!to.length) {
      return jsonResponse(req, 400, { ok: false, error: "Recipient (to) is required" });
    }
    if (!subject) {
      return jsonResponse(req, 400, { ok: false, error: "Subject is required" });
    }
    if (!text) {
      return jsonResponse(req, 400, { ok: false, error: "Message body is required" });
    }

    const integration = await resolveEmailIntegration({
      workspaceId,
      userId,
      integrationId: String(payload.integrationId || "").trim(),
      refreshToken: String(payload.refreshToken || "").trim()
    });

    const accessToken = await getGoogleAccessToken(integration.refreshToken);
    const fromEmail = explicitFrom || integration.fromEmail || "";
    const fromHeader = fromEmail ? (fromName ? `${fromName} <${fromEmail}>` : fromEmail) : "me";
    const raw = buildRawMimeEmail({ from: fromHeader, to, cc, bcc, subject, text, html });
    const gmailResult = await sendGmailMessage({ accessToken, raw });

    await logCommunication({
      workspaceId,
      userId,
      channel: "email",
      provider: "gmail",
      direction: "outbound",
      to,
      from: fromEmail || null,
      subject,
      body: text,
      entityType: String(payload.entityType || "").trim() || null,
      entityId: String(payload.entityId || "").trim() || null,
      externalId: String(gmailResult.id || "").trim() || null,
      status: "sent",
      meta: { threadId: String(gmailResult.threadId || "").trim() || null }
    });

    await logActivity({
      workspaceId,
      actorId: auth.caller?.uid || userId || "system",
      action: "email_sent",
      entityType: String(payload.entityType || "").trim() || null,
      entityId: String(payload.entityId || "").trim() || null,
      summary: `Email sent to ${to.join(", ")}`,
      meta: { provider: "gmail", subject, externalId: String(gmailResult.id || "").trim() || null }
    });

    return jsonResponse(req, 200, {
      ok: true,
      provider: "gmail",
      id: String(gmailResult.id || "").trim() || null,
      threadId: String(gmailResult.threadId || "").trim() || null
    });
  } catch (error) {
    console.error("send-email-via-gmail failed", error);
    const reconnectRequired = isGoogleReconnectRequiredError(error);
    return jsonResponse(req, reconnectRequired ? 401 : 500, {
      ok: false,
      error: normalizeGoogleReconnectErrorMessage(error),
      reconnectRequired
    });
  }
});
