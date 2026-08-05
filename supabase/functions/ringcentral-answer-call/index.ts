import { getCallLogById, getTelephonyPartyPath, patchCallLog, resolveWorkspaceMemberContext, ringCentralRequest } from "../_shared/ringcentral.ts";
import { handleCors, jsonResponse, methodNotAllowed, requireCaller } from "../_shared/runtime.ts";

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
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
    const callLogId = normalizeText(payload.callLogId);
    if (!callLogId) {
      return jsonResponse(req, 400, { ok: false, error: "Call id is required." });
    }

    const member = await resolveWorkspaceMemberContext({
      uid: auth.caller?.uid,
      email: auth.caller?.email
    });
    const callLog = await getCallLogById(callLogId);
    if (!callLog || String(callLog.workspace_id || "") !== member.workspaceId) {
      return jsonResponse(req, 404, { ok: false, error: "Call record not found." });
    }
    if (String(callLog.member_id || "") !== member.memberId) {
      return jsonResponse(req, 403, { ok: false, error: "This call is not assigned to the current agent." });
    }

    const providerResult = await ringCentralRequest(`${getTelephonyPartyPath(callLog)}/answer`, {
      method: "POST"
    });

    await patchCallLog(callLogId, {
      status: "connected",
      answered_at: new Date().toISOString(),
      popup_seen_at: new Date().toISOString(),
      raw_payload: {
        ...(callLog.raw_payload && typeof callLog.raw_payload === "object" ? callLog.raw_payload : {}),
        answerResult: providerResult
      }
    });

    return jsonResponse(req, 200, {
      ok: true,
      callLogId,
      providerResult
    });
  } catch (error) {
    console.error("ringcentral-answer-call failed", error);
    return jsonResponse(req, 500, { ok: false, error: String(error instanceof Error ? error.message : error) });
  }
});
