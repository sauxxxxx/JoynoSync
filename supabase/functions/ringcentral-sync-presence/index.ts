import {
  mapProviderCallStatus,
  resolveTelephonyIdentity,
  resolveWorkspaceMemberContext,
  ringCentralRequest,
  upsertAgentPresence
} from "../_shared/ringcentral.ts";
import { handleCors, jsonResponse, methodNotAllowed, requireCaller } from "../_shared/runtime.ts";

function normalizeText(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function mapPresenceStatus(payload: Record<string, unknown>) {
  const userStatus = normalizeText(payload.userStatus || payload.presenceStatus || payload.status, "Available");
  const telephony = normalizeText(payload.telephonyStatus || payload.extensionStatus || "");
  if (["offline", "notavailable", "dnd"].includes(userStatus.toLowerCase())) {
    return userStatus.toLowerCase() === "dnd" ? "Dnd" : "Offline";
  }
  if (["busy", "oncall", "ringing"].includes(telephony.toLowerCase())) {
    return "Busy";
  }
  return "Available";
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
    const member = await resolveWorkspaceMemberContext({
      uid: auth.caller?.uid,
      email: auth.caller?.email
    });
    const identity = await resolveTelephonyIdentity(member.workspaceId, member.memberId);
    if (!identity.providerExtensionRef) {
      return jsonResponse(req, 400, { ok: false, error: "No telephony identity is configured for this member." });
    }

    const presence = await ringCentralRequest(`/restapi/v1.0/account/~/extension/${identity.providerExtensionRef}/presence`, {
      query: {
        detailedTelephonyState: true
      }
    });
    const activeCalls = Array.isArray((presence as Record<string, unknown>).activeCalls)
      ? ((presence as Record<string, unknown>).activeCalls as unknown[]).length
      : 0;

    await upsertAgentPresence(member.workspaceId, member.memberId, {
      presenceStatus: mapPresenceStatus(presence),
      telephonyStatus: normalizeText((presence as Record<string, unknown>).telephonyStatus || ""),
      activeCallCount: activeCalls,
      metadata: presence
    });

    return jsonResponse(req, 200, {
      ok: true,
      presenceStatus: mapPresenceStatus(presence),
      telephonyStatus: normalizeText((presence as Record<string, unknown>).telephonyStatus || ""),
      activeCallCount: activeCalls,
      providerState: mapProviderCallStatus((presence as Record<string, unknown>).telephonyStatus || "")
    });
  } catch (error) {
    console.error("ringcentral-sync-presence failed", error);
    return jsonResponse(req, 500, { ok: false, error: String(error instanceof Error ? error.message : error) });
  }
});
