import {
  resolveTelephonyIdentity,
  resolveWorkspaceMemberContext,
  ringCentralRequest,
  upsertAgentPresence,
  upsertCallQueue,
  upsertQueueMembership
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

  try {
    const member = await resolveWorkspaceMemberContext({
      uid: auth.caller?.uid,
      email: auth.caller?.email
    });
    const identity = await resolveTelephonyIdentity(member.workspaceId, member.memberId);
    if (!identity.providerExtensionRef) {
      return jsonResponse(req, 400, { ok: false, error: "No telephony identity is configured for this member." });
    }

    const queueList = await ringCentralRequest("/restapi/v1.0/account/~/call-queues");
    const records = Array.isArray((queueList as Record<string, unknown>).records)
      ? ((queueList as Record<string, unknown>).records as Record<string, unknown>[])
      : [];
    for (const queue of records) {
      await upsertCallQueue(member.workspaceId, queue);
    }

    const queuePresence = await ringCentralRequest(`/restapi/v1.0/account/~/extension/${identity.providerExtensionRef}/call-queue-presence`);
    const memberships = Array.isArray((queuePresence as Record<string, unknown>).records)
      ? ((queuePresence as Record<string, unknown>).records as Record<string, unknown>[])
      : [];
    let acceptingCalls = true;
    for (const item of memberships) {
      const queue = (item.callQueue && typeof item.callQueue === "object" ? item.callQueue : {}) as Record<string, unknown>;
      const queueId = String(queue.id || "");
      const acceptCalls = item.acceptCalls !== false;
      acceptingCalls = acceptingCalls && acceptCalls;
      if (queueId) {
        await upsertQueueMembership(member.workspaceId, member.memberId, queueId, acceptCalls);
      }
    }

    await upsertAgentPresence(member.workspaceId, member.memberId, {
      acceptingQueueCalls: acceptingCalls,
      metadata: {
        queuePresence
      }
    });

    return jsonResponse(req, 200, {
      ok: true,
      queueCount: records.length,
      membershipCount: memberships.length,
      acceptingCalls
    });
  } catch (error) {
    console.error("ringcentral-sync-queues failed", error);
    return jsonResponse(req, 500, { ok: false, error: String(error instanceof Error ? error.message : error) });
  }
});
