import {
  getCallLogById,
  getRingOutPath,
  getTelephonyPartyPath,
  patchCallLog,
  resolveTelephonyIdentity,
  resolveWorkspaceMemberContext,
  ringCentralRequest
} from "../_shared/ringcentral.ts";
import { handleCors, jsonResponse, methodNotAllowed, requireCaller } from "../_shared/runtime.ts";

function normalizeText(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function buildActionRequest(
  callLog: Record<string, unknown>,
  action: string,
  payload: Record<string, unknown>,
  identity: { providerExtensionRef?: string } = {}
) {
  const ringOutId = normalizeText(callLog.provider_call_id || callLog.providerCallId);
  const hasTelephonyParty =
    normalizeText(callLog.provider_session_id || callLog.providerSessionId) &&
    normalizeText(callLog.provider_party_id || callLog.providerPartyId);
  const base = hasTelephonyParty ? getTelephonyPartyPath(callLog) : "";
  if (action === "mute") {
    return { method: "PATCH", path: base, body: { muted: true } };
  }
  if (action === "unmute") {
    return { method: "PATCH", path: base, body: { muted: false } };
  }
  if (action === "hold") {
    return { method: "POST", path: `${base}/hold` };
  }
  if (action === "unhold") {
    return { method: "POST", path: `${base}/unhold` };
  }
  if (action === "hangup") {
    if (base) {
      return { method: "DELETE", path: base };
    }
    if (ringOutId) {
      return {
        method: "DELETE",
        path: `${getRingOutPath(normalizeText(identity.providerExtensionRef))}/${ringOutId}`
      };
    }
    throw new Error("This call does not have a provider session or RingOut request yet.");
  }
  if (action === "transfer") {
    const target = normalizeText(payload.transferTarget);
    if (!target) {
      throw new Error("A transfer target is required.");
    }
    return {
      method: "POST",
      path: `${base}/transfer`,
      body: {
        phoneNumber: target
      }
    };
  }
  if (action === "dtmf") {
    const digits = normalizeText(payload.digits);
    if (!digits) {
      throw new Error("Digits are required.");
    }
    return {
      method: "POST",
      path: `${base}/play`,
      body: {
        digits
      }
    };
  }
  if (action === "record-start") {
    return {
      method: "POST",
      path: `${base}/recordings/start`
    };
  }
  if (action === "record-stop") {
    return {
      method: "POST",
      path: `${base}/recordings/stop`
    };
  }
  throw new Error("Unsupported call control action.");
}

function buildCallLogPatch(action: string, payload: Record<string, unknown>) {
  if (action === "mute") {
    return { muted: true };
  }
  if (action === "unmute") {
    return { muted: false };
  }
  if (action === "hold") {
    return { on_hold: true, status: "hold" };
  }
  if (action === "unhold") {
    return { on_hold: false, status: "connected" };
  }
  if (action === "hangup") {
    return { status: "wrapup", ended_at: new Date().toISOString() };
  }
  if (action === "transfer") {
    return {
      status: "transferring",
      transfer_target: normalizeText(payload.transferTarget)
    };
  }
  if (action === "record-start") {
    return {
      recording_enabled: true,
      recording_status: "recording"
    };
  }
  if (action === "record-stop") {
    return {
      recording_status: "completed"
    };
  }
  return {};
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

  let payload: Record<string, unknown> = {};
  let action = "";
  let callLogId = "";
  let callLog: Record<string, unknown> | null = null;

  try {
    payload = await req.json().catch(() => ({}));
    action = normalizeText(payload.action).toLowerCase();
    callLogId = normalizeText(payload.callLogId);
    if (!action || !callLogId) {
      return jsonResponse(req, 400, { ok: false, error: "Call id and action are required." });
    }

    const member = await resolveWorkspaceMemberContext({
      uid: auth.caller?.uid,
      email: auth.caller?.email
    });
    const identity = await resolveTelephonyIdentity(member.workspaceId, member.memberId);
    callLog = await getCallLogById(callLogId);
    if (!callLog || String(callLog.workspace_id || "") !== member.workspaceId) {
      return jsonResponse(req, 404, { ok: false, error: "Call record not found." });
    }
    if (String(callLog.member_id || "") !== member.memberId) {
      return jsonResponse(req, 403, { ok: false, error: "This call is not assigned to the current agent." });
    }

    const requestConfig = buildActionRequest(callLog, action, payload, identity);
    const providerResult = await ringCentralRequest(requestConfig.path, {
      method: requestConfig.method,
      body: requestConfig.body
    });

    const patch = {
      ...buildCallLogPatch(action, payload),
      raw_payload: {
        ...(callLog.raw_payload && typeof callLog.raw_payload === "object" ? callLog.raw_payload : {}),
        lastControlAction: action,
        lastControlResult: providerResult
      }
    };
    await patchCallLog(callLogId, patch);

    return jsonResponse(req, 200, {
      ok: true,
      action,
      callLogId,
      providerResult
    });
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    if (
      normalizeText(payload?.action).toLowerCase() === "hangup" &&
      message.includes("does not have a provider session or RingOut request yet.")
    ) {
      try {
        const fallbackCallLogId = normalizeText(payload?.callLogId);
        if (fallbackCallLogId) {
          await patchCallLog(fallbackCallLogId, {
            status: "canceled",
            ended_at: new Date().toISOString(),
            disposition: normalizeText(callLog?.disposition || callLog?.disposition, "Canceled"),
            recording_status: "off",
            raw_payload: {
              ...(callLog?.raw_payload && typeof callLog.raw_payload === "object" ? callLog.raw_payload : {}),
              lastControlAction: "hangup",
              lastControlResult: {
                ignored: true,
                reason: "missing_provider_call"
              }
            }
          });
        }
        return jsonResponse(req, 200, {
          ok: true,
          action: "hangup",
          callLogId: normalizeText(payload?.callLogId),
          providerResult: {
            ignored: true,
            reason: "missing_provider_call"
          }
        });
      } catch (fallbackError) {
        console.error("ringcentral-call-control missing-provider hangup fallback failed", fallbackError);
      }
    }
    if (
      normalizeText(payload?.action).toLowerCase() === "hangup" &&
      message.includes("(404)") &&
      (message.toLowerCase().includes("ringoutid") || message.toLowerCase().includes("not found"))
    ) {
      try {
        const fallbackCallLogId = normalizeText(payload?.callLogId);
        if (fallbackCallLogId) {
          await patchCallLog(fallbackCallLogId, {
            ...buildCallLogPatch("hangup", payload),
            raw_payload: {
              ...(callLog?.raw_payload && typeof callLog.raw_payload === "object" ? callLog.raw_payload : {}),
              lastControlAction: "hangup",
              lastControlResult: {
                ignored: true,
                reason: "ringout_not_found"
              }
            }
          });
        }
        return jsonResponse(req, 200, {
          ok: true,
          action: "hangup",
          callLogId: normalizeText(payload?.callLogId),
          providerResult: {
            ignored: true,
            reason: "ringout_not_found"
          }
        });
      } catch (fallbackError) {
        console.error("ringcentral-call-control fallback hangup failed", fallbackError);
      }
    }
    console.error("ringcentral-call-control failed", error);
    return jsonResponse(req, 500, { ok: false, error: message });
  }
});
