import {
  getRingOutPath,
  normalizePhoneNumber,
  patchCallLog,
  resolveTelephonyIdentity,
  resolveWorkspaceMemberContext,
  ringCentralRequest,
  upsertCallLog
} from "../_shared/ringcentral.ts";
import { handleCors, jsonResponse, methodNotAllowed, requireCaller } from "../_shared/runtime.ts";

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
  let callLog: Record<string, unknown> | null = null;

  try {
    payload = await req.json().catch(() => ({}));
    const providerConfigured = [
      "RINGCENTRAL_CLIENT_ID",
      "RINGCENTRAL_CLIENT_SECRET",
      "RINGCENTRAL_JWT"
    ].every((name) => String(Deno.env.get(name) || "").trim());
    if (!providerConfigured) {
      return jsonResponse(req, 503, {
        ok: false,
        error: "RingCentral calling is not configured. Ask an administrator to finish the RingCentral connection."
      });
    }
    const toNumber = normalizePhoneNumber(payload.to);
    if (!toNumber) {
      return jsonResponse(req, 400, { ok: false, error: "A valid destination number is required." });
    }

    const member = await resolveWorkspaceMemberContext({
      uid: auth.caller?.uid,
      email: auth.caller?.email
    });
    const identity = await resolveTelephonyIdentity(member.workspaceId, member.memberId);
    if (!identity.id || !identity.providerExtensionRef) {
      return jsonResponse(req, 409, {
        ok: false,
        error: "Your RingCentral extension is not connected. Ask an administrator to map your JoynoSync account."
      });
    }

    callLog = await upsertCallLog({
      workspaceId: member.workspaceId,
      memberId: member.memberId,
      direction: "outbound",
      fromNumber: identity.callerId || identity.directNumber,
      toNumber,
      counterpartyName: String(payload.displayName || payload.linkedLabel || toNumber),
      status: "dialing",
      recordingEnabled: Boolean(payload.record),
      recordingStatus: payload.record ? "pending" : "off",
      linkedEntityType: String(payload.linkedEntityType || ""),
      linkedEntityId: String(payload.linkedEntityId || ""),
      linkedLabelSnapshot: String(payload.linkedLabel || ""),
      wrapupNotes: String(payload.note || ""),
      startedAt: new Date().toISOString(),
      rawPayload: {
        request: payload,
        transport: "ringout"
      }
    });

    const result = await ringCentralRequest(getRingOutPath(identity.providerExtensionRef), {
      method: "POST",
      body: {
        from: {
          phoneNumber: identity.callerId || identity.directNumber
        },
        to: {
          phoneNumber: toNumber
        },
        playPrompt: false
      }
    });

    const updated = await patchCallLog(String(callLog?.id || ""), {
      provider_call_id: String(result.id || ""),
      raw_payload: {
        request: payload,
        transport: "ringout",
        providerResponse: result
      }
    });

    return jsonResponse(req, 200, {
      ok: true,
      callLogId: String(updated?.id || callLog?.id || ""),
      providerCallId: String(result.id || ""),
      status: "dialing"
    });
  } catch (error) {
    if (callLog?.id) {
      try {
        await patchCallLog(String(callLog.id), {
          status: "failed",
          ended_at: new Date().toISOString(),
          disposition: "Failed",
          recording_status: "failed",
          raw_payload: {
            ...(callLog.raw_payload && typeof callLog.raw_payload === "object" ? callLog.raw_payload : {}),
            request: payload,
            transport: "ringout",
            providerError: String(error instanceof Error ? error.message : error)
          }
        });
      } catch (patchError) {
        console.error("ringcentral-start-call failure patch failed", patchError);
      }
    }
    console.error("ringcentral-start-call failed", error);
    return jsonResponse(req, 500, { ok: false, error: String(error instanceof Error ? error.message : error) });
  }
});
