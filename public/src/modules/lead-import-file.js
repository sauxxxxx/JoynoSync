import { LEAD_IMPORT_HEADER_ALIASES, normalizeLeadImportHeader } from "./lead-import-policy.js";

const XLSX_CDN = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
const HEADER_SCAN_LIMIT = 20;
const HEADER_ALIASES = new Set(Object.values(LEAD_IMPORT_HEADER_ALIASES).flat().map(normalizeLeadImportHeader));

function ensureUniqueHeaders(headers) {
  const seen = new Map();
  return headers.map((header, index) => {
    const base = String(header || "").trim() || `Column ${index + 1}`;
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count ? `${base} (${count + 1})` : base;
  });
}

function headerScore(row) {
  const normalized = (Array.isArray(row) ? row : []).map(normalizeLeadImportHeader).filter(Boolean);
  const knownFields = new Set(normalized.filter((value) => HEADER_ALIASES.has(value)));
  return knownFields.size * 10 + Math.min(normalized.length, 9);
}

export function parseCsvMatrix(text) {
  const rows = [];
  let row = [];
  let value = "";
  let insideQuotes = false;
  const raw = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];
    if (insideQuotes) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        insideQuotes = false;
      } else {
        value += char;
      }
    } else if (char === '"') {
      insideQuotes = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (value.length || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

export function normalizeLeadImportSheetRows(matrix, metadata = {}) {
  const sourceRows = Array.isArray(matrix) ? matrix.filter((row) => Array.isArray(row)) : [];
  const nonEmptyRows = sourceRows.filter((row) => row.some((cell) => String(cell ?? "").trim()));
  if (!nonEmptyRows.length) {
    return { headers: [], rows: [], headerRowNumber: 0, skippedPreambleRows: 0, ...metadata };
  }

  const candidates = nonEmptyRows.slice(0, HEADER_SCAN_LIMIT).map((row, index) => ({ index, score: headerScore(row) }));
  const best = candidates.reduce((current, candidate) => (candidate.score > current.score ? candidate : current), candidates[0]);
  const headerIndex = best.score >= 20 ? best.index : 0;
  const dataRows = nonEmptyRows.slice(headerIndex);
  const width = Math.max(...dataRows.map((row) => row.length), 0);
  const paddedRows = dataRows.map((row) => Array.from({ length: width }, (_, index) => String(row[index] ?? "").trim()));

  return {
    headers: ensureUniqueHeaders(paddedRows[0] || []),
    rows: paddedRows.slice(1).filter((row) => row.some((cell) => String(cell || "").trim())),
    headerRowNumber: sourceRows.indexOf(nonEmptyRows[headerIndex]) + 1,
    skippedPreambleRows: headerIndex,
    ...metadata
  };
}

function loadXlsxLibrary() {
  if (window.XLSX) {
    return Promise.resolve(window.XLSX);
  }
  return new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-xlsx-loader='lead-import']");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.XLSX), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load spreadsheet parser.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = XLSX_CDN;
    script.async = true;
    script.dataset.xlsxLoader = "lead-import";
    script.addEventListener("load", () => resolve(window.XLSX), { once: true });
    script.addEventListener("error", () => reject(new Error("Failed to load spreadsheet parser.")), { once: true });
    document.head.appendChild(script);
  });
}

export async function parseLeadImportFile(file) {
  const name = String(file?.name || "").trim();
  const extension = name.split(".").pop()?.toLowerCase() || "";
  if (extension === "csv") {
    return normalizeLeadImportSheetRows(parseCsvMatrix(await file.text()), { sheetName: "CSV" });
  }
  if (extension !== "xlsx" && extension !== "xls") {
    throw new Error("Unsupported file type. Use CSV or XLSX.");
  }

  const XLSX = await loadXlsxLibrary();
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  const candidates = (workbook.SheetNames || []).map((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const matrix = worksheet ? XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "", raw: false }) : [];
    const parsed = normalizeLeadImportSheetRows(matrix, { sheetName });
    return { parsed, score: parsed.headers.reduce((total, header) => total + (HEADER_ALIASES.has(normalizeLeadImportHeader(header)) ? 1 : 0), 0) };
  });
  const selected = candidates.sort((left, right) => right.score - left.score || right.parsed.rows.length - left.parsed.rows.length)[0];
  if (!selected?.parsed?.headers?.length) {
    throw new Error("The spreadsheet does not contain an importable sheet.");
  }
  return selected.parsed;
}
