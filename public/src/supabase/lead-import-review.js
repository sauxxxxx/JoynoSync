import { initSupabase } from "./init.js";

function getSupabaseClient() {
  const services = initSupabase();
  if (!services.configured || !services.client) {
    throw new Error("Supabase is not configured.");
  }
  return services.client;
}

function normalizeReviewRow(row) {
  return {
    rowNumber: Number(row?.rowNumber || 0),
    leadId: String(row?.values?.leadId || "").trim(),
    updatedAt: String(row?.values?.updatedAt || "").trim(),
    name: String(row?.values?.name || "").trim(),
    company: String(row?.values?.company || "").trim(),
    email: String(row?.values?.email || "").trim().toLowerCase(),
    phone: String(row?.values?.phone || "").trim(),
    secondaryPhone: String(row?.values?.secondaryPhone || "").trim()
  };
}

const REVIEW_BATCH_SIZE = 200;

function chunkRows(rows, size = REVIEW_BATCH_SIZE) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

function buildReviewError(error, batchNumber, batchCount) {
  const detail = String(error?.message || error?.details || error?.hint || "Workspace verification failed.").trim();
  const code = String(error?.code || "").trim();
  const batchLabel = batchCount > 1 ? ` Batch ${batchNumber} of ${batchCount} failed.` : "";
  const nextError = new Error(`${detail}${batchLabel}`.trim());
  if (code) {
    nextError.code = code;
  }
  return nextError;
}

export async function reviewSupabaseLeadImportRows(importMode, rows = []) {
  const client = getSupabaseClient();
  const normalizedRows = (Array.isArray(rows) ? rows : []).map(normalizeReviewRow);
  const batches = chunkRows(normalizedRows);
  const matches = [];
  for (let index = 0; index < batches.length; index += 1) {
    const { data, error } = await client.rpc("review_lead_import_matches", {
      p_import_mode: String(importMode || "new").trim(),
      p_rows: batches[index]
    });
    if (error) {
      throw buildReviewError(error, index + 1, batches.length);
    }
    matches.push(...(Array.isArray(data?.rows) ? data.rows : []));
  }
  return matches;
}
