import { resolveTelephonyIdentity, resolveWorkspaceMemberContext, ringCentralRequest, upsertVoicemail } from "../_shared/ringcentral.ts";
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

  try {
    const member = await resolveWorkspaceMemberContext({
      uid: auth.caller?.uid,
      email: auth.caller?.email
    });
    const identity = await resolveTelephonyIdentity(member.workspaceId, member.memberId);
    if (!identity.providerExtensionRef) {
      return jsonResponse(req, 400, { ok: false, error: "No telephony identity is configured for this member." });
    }

    const messageStore = await ringCentralRequest(`/restapi/v1.0/account/~/extension/${identity.providerExtensionRef}/message-store`, {
      query: {
        messageType: "VoiceMail",
        availability: "Alive",
        perPage: 100
      }
    });
    const records = Array.isArray((messageStore as Record<string, unknown>).records)
      ? ((messageStore as Record<string, unknown>).records as Record<string, unknown>[])
      : [];

    for (const item of records) {
      await upsertVoicemail(member.workspaceId, member.memberId, item);
    }

    return jsonResponse(req, 200, {
      ok: true,
      voicemailCount: records.length
    });
  } catch (error) {
    console.error("ringcentral-sync-voicemails failed", error);
    return jsonResponse(req, 500, { ok: false, error: String(error instanceof Error ? error.message : error) });
  }
});
