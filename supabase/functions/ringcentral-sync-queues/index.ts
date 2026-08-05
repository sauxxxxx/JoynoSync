import {
  resolveTelephonyIdentity,
  resolveWorkspaceMemberContext,
  ringCentralRequest,
  upsertAgentPresence,
  upsertCallQueue,
  upsertQueueMembership
} from "../_shared/ringcentral.ts";
import { createServiceClient, handleCors, jsonResponse, methodNotAllowed, requireCaller } from "../_shared/runtime.ts";

function isUnavailableCallQueuePresence(error: unknown) {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return message.includes("ringcentral request failed (403)") &&
    message.includes("callqueuepresence") &&
    message.includes("not available");
}

async function recordProviderSync(workspaceId: string, memberId: string) {
  const syncedAt = new Date().toISOString();
  const service = createServiceClient();
  const { data, error } = await service.from("agent_presence")
    .update({ last_provider_sync_at: syncedAt })
    .eq("workspace_id", workspaceId)
    .eq("member_id", memberId)
    .eq("provider", "ringcentral")
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const { error: insertError } = await service.from("agent_presence").insert({
      workspace_id: workspaceId,
      member_id: memberId,
      provider: "ringcentral",
      presence_status: "Available",
      accepting_queue_calls: true,
      telephony_status: "",
      active_call_count: 0,
      last_provider_sync_at: syncedAt,
      metadata: {}
    });
    if (insertError?.code === "23505") {
      const { error: retryError } = await service.from("agent_presence")
        .update({ last_provider_sync_at: syncedAt })
        .eq("workspace_id", workspaceId)
        .eq("member_id", memberId)
        .eq("provider", "ringcentral");
      if (retryError) throw retryError;
    } else if (insertError) {
      throw insertError;
    }
  }
  return syncedAt;
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

    const queueList = await ringCentralRequest("/restapi/v1.0/account/~/call-queues");
    const records = Array.isArray((queueList as Record<string, unknown>).records)
      ? ((queueList as Record<string, unknown>).records as Record<string, unknown>[])
      : [];
    for (const queue of records) {
      await upsertCallQueue(member.workspaceId, queue);
    }

    let queuePresence: Record<string, unknown>;
    try {
      queuePresence = await ringCentralRequest(`/restapi/v1.0/account/~/extension/${identity.providerExtensionRef}/call-queue-presence`);
    } catch (error) {
      if (!isUnavailableCallQueuePresence(error)) {
        throw error;
      }

      console.info("ringcentral-sync-queues skipped unsupported CallQueuePresence capability", {
        workspaceId: member.workspaceId,
        memberId: member.memberId
      });
      const syncedAt = await recordProviderSync(member.workspaceId, member.memberId);
      return jsonResponse(req, 200, {
        ok: true,
        skipped: true,
        reason: "call-queue-presence-unavailable",
        syncedAt,
        queueCount: records.length,
        membershipCount: 0
      });
    }
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
