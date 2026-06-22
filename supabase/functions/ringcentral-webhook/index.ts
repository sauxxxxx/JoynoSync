import {
  findTelephonyIdentityByExtensionRef,
  insertCallEvent,
  mapProviderCallStatus,
  parseTelephonyNotification,
  upsertCallLog
} from "../_shared/ringcentral.ts";
import { handleCors, jsonResponse, methodNotAllowed } from "../_shared/runtime.ts";

function normalizeText(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function extractExtensionRef(party: Record<string, unknown>) {
  const extension = party.extension && typeof party.extension === "object" ? (party.extension as Record<string, unknown>) : {};
  const from = party.from && typeof party.from === "object" ? (party.from as Record<string, unknown>) : {};
  const to = party.to && typeof party.to === "object" ? (party.to as Record<string, unknown>) : {};
  return normalizeText(
    party.extensionId ||
      extension.id ||
      extension.extensionNumber ||
      party.extensionNumber ||
      from.extensionNumber ||
      to.extensionNumber
  );
}

function extractPhone(endpoint: unknown) {
  if (!endpoint || typeof endpoint !== "object") {
    return "";
  }
  const value = endpoint as Record<string, unknown>;
  return normalizeText(value.phoneNumber || value.phone_number);
}

function extractName(endpoint: unknown) {
  if (!endpoint || typeof endpoint !== "object") {
    return "";
  }
  return normalizeText((endpoint as Record<string, unknown>).name);
}

function buildDirection(party: Record<string, unknown>) {
  const direction = normalizeText(party.direction || party.callDirection).toLowerCase();
  return direction === "inbound" ? "inbound" : "outbound";
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) {
    return corsResponse;
  }
  if (req.method !== "POST") {
    return methodNotAllowed(req, ["POST"]);
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const notification = parseTelephonyNotification(payload as Record<string, unknown>);
    let processed = 0;

    for (const party of notification.parties) {
      const extensionRef = extractExtensionRef(party);
      const identity = await findTelephonyIdentityByExtensionRef(extensionRef);
      if (!identity) {
        continue;
      }

      const direction = buildDirection(party);
      const fromNumber = extractPhone(party.from);
      const toNumber = extractPhone(party.to);
      const providerStatus = (party.status && typeof party.status === "object"
        ? (party.status as Record<string, unknown>).code
        : party.status) || "";
      const status = mapProviderCallStatus(
        providerStatus,
        direction
      );
      const queue = party.queue && typeof party.queue === "object" ? (party.queue as Record<string, unknown>) : {};
      const callLog = await upsertCallLog({
        workspaceId: identity.workspaceId,
        memberId: identity.memberId,
        providerCallId: normalizeText((party as Record<string, unknown>).id || notification.sessionId),
        providerSessionId: normalizeText(notification.sessionId),
        providerPartyId: normalizeText((party as Record<string, unknown>).id),
        providerQueueId: normalizeText((party as Record<string, unknown>).queueId || queue.id),
        queueNameSnapshot: normalizeText((party as Record<string, unknown>).queueName || queue.name),
        direction,
        fromNumber,
        toNumber,
        counterpartyName: direction === "inbound" ? extractName(party.from) || fromNumber : extractName(party.to) || toNumber,
        status,
        muted: Boolean((party as Record<string, unknown>).muted),
        onHold: mapProviderCallStatus(providerStatus, direction) === "hold",
        startedAt: normalizeText((party as Record<string, unknown>).startTime),
        answeredAt: normalizeText((party as Record<string, unknown>).acceptTime || (party as Record<string, unknown>).answeredTime),
        endedAt: normalizeText((party as Record<string, unknown>).endTime),
        durationSeconds: Number((party as Record<string, unknown>).duration || 0) || 0,
        rawPayload: payload
      });
      await insertCallEvent(identity.workspaceId, normalizeText(callLog?.id), notification.eventType, payload, normalizeText((payload as Record<string, unknown>).uuid));
      processed += 1;
    }

    return jsonResponse(req, 200, {
      ok: true,
      processed
    });
  } catch (error) {
    console.error("ringcentral-webhook failed", error);
    return jsonResponse(req, 500, { ok: false, error: String(error instanceof Error ? error.message : error) });
  }
});
