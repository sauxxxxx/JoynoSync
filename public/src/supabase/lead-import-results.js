import { initSupabase } from "./init.js";

function getSupabaseClient() {
  const services = initSupabase();
  if (!services.configured || !services.client) {
    throw new Error("Supabase is not configured.");
  }
  return services.client;
}

export async function fetchSupabaseLeadImportResults(jobId) {
  const normalizedJobId = String(jobId || "").trim();
  if (!normalizedJobId) {
    throw new Error("Import job ID is unavailable.");
  }
  const client = getSupabaseClient();
  const { data, error } = await client.rpc("get_lead_import_results", { p_job_id: normalizedJobId });
  if (error) {
    throw error;
  }
  return Array.isArray(data?.rows) ? data.rows : [];
}
