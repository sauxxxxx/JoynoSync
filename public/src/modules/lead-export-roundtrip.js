const EXPORT_BATCH_SIZE = 200;

export async function hydrateLeadExportRows(client, rows = []) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const ids = [...new Set(sourceRows.map((row) => String(row?.id || "").trim()).filter(Boolean))];
  if (!client || !ids.length) {
    return sourceRows;
  }

  const details = [];
  for (let index = 0; index < ids.length; index += EXPORT_BATCH_SIZE) {
    const batchIds = ids.slice(index, index + EXPORT_BATCH_SIZE);
    const { data, error } = await client
      .from("leads")
      .select("id,name,company_name,email,phone,secondary_phone,source,status,interest,next_follow_up_date,role,tags,notes,archived_at,created_at,updated_at")
      .in("id", batchIds);
    if (error) {
      throw error;
    }
    details.push(...(Array.isArray(data) ? data : []));
  }

  const detailById = new Map(details.map((row) => [String(row?.id || "").trim(), row]));
  return sourceRows.map((row) => ({ ...row, ...(detailById.get(String(row?.id || "").trim()) || {}) }));
}
