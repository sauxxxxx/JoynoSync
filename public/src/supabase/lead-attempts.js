import { initSupabase } from "./init.js";

export async function recordSupabaseLeadAttempt(leadId, reason, note = "") {
  const services = initSupabase();
  if (!services.configured || !services.client) {
    throw new Error("Supabase is not configured.");
  }
  const { data, error } = await services.client.rpc("record_lead_attempt", {
    p_lead_id: String(leadId || "").trim(),
    p_reason: String(reason || "").trim(),
    p_note: String(note || "").trim()
  });
  if (error) {
    throw error;
  }
  return data && typeof data === "object" ? data : {};
}
