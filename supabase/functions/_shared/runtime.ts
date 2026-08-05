import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";

const DEFAULT_SUPABASE_URL = "https://ihrputhrxkrpyrgydsat.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_ZwDQjjcd5SGFVb-Aqt4_Fg_9ioHdUOu";

let cachedServiceClient: SupabaseClient | null = null;

function splitEnvList(value: string) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const allowedOrigins = splitEnvList(Deno.env.get("CORS_ORIGIN") || "");

export function normalizeUrl(value: string) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function getEnv(name: string, fallback = "") {
  const value = Deno.env.get(name);
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return value;
}

export function getRequiredEnv(name: string) {
  const value = getEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getSupabaseUrl() {
  return normalizeUrl(getEnv("SUPABASE_URL", DEFAULT_SUPABASE_URL));
}

export function getSupabaseAnonKey() {
  return String(getEnv("SUPABASE_ANON_KEY", DEFAULT_SUPABASE_ANON_KEY) || "").trim();
}

export function getSupabaseServiceRoleKey() {
  return String(getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
}

export function createServiceClient() {
  if (cachedServiceClient) {
    return cachedServiceClient;
  }
  cachedServiceClient = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
  return cachedServiceClient;
}

export function createUserClient(accessToken: string) {
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  });
}

function buildCorsHeaders(req: Request, extras: HeadersInit = {}) {
  const origin = String(req.headers.get("origin") || "").trim();
  const headers = new Headers(extras);

  if (origin) {
    headers.set("Access-Control-Allow-Origin", allowedOrigins.length && !allowedOrigins.includes(origin) ? "null" : origin);
    headers.set("Vary", "Origin");
  } else if (!allowedOrigins.length) {
    headers.set("Access-Control-Allow-Origin", "*");
  }

  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization,apikey,x-client-info");
  return headers;
}

export function handleCors(req: Request) {
  const origin = String(req.headers.get("origin") || "").trim();
  if (origin && allowedOrigins.length && !allowedOrigins.includes(origin)) {
    return new Response(JSON.stringify({ ok: false, error: "Origin not allowed" }), {
      status: 403,
      headers: buildCorsHeaders(req, {
        "Content-Type": "application/json; charset=utf-8"
      })
    });
  }

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: buildCorsHeaders(req)
    });
  }

  return null;
}

export function jsonResponse(req: Request, status: number, payload: unknown, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: buildCorsHeaders(req, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      ...headers
    })
  });
}

export function redirectResponse(req: Request, location: string, status = 302) {
  return new Response("", {
    status,
    headers: buildCorsHeaders(req, {
      Location: location,
      "Cache-Control": "no-store, max-age=0"
    })
  });
}

export function methodNotAllowed(req: Request, methods: string[]) {
  return jsonResponse(req, 405, { ok: false, error: `Method ${req.method} not allowed` }, { Allow: methods.join(",") });
}

export function getBearerToken(req: Request) {
  const value = String(req.headers.get("authorization") || "");
  if (!value.startsWith("Bearer ")) {
    return "";
  }
  return value.slice(7).trim();
}

export type Caller = {
  uid: string;
  email: string;
  provider: string;
  claims: User;
};

export async function requireCaller(req: Request): Promise<{ caller?: Caller; response?: Response }> {
  const token = getBearerToken(req);
  if (!token) {
    return {
      response: jsonResponse(req, 401, { ok: false, error: "Missing auth token" })
    };
  }

  try {
    const userClient = createUserClient(token);
    const {
      data: { user },
      error
    } = await userClient.auth.getUser(token);

    if (error || !user) {
      throw error || new Error("Invalid auth token");
    }

    const appMetadata = user.app_metadata && typeof user.app_metadata === "object" ? user.app_metadata : {};
    const providers = Array.isArray(appMetadata.providers) ? appMetadata.providers : [];

    return {
      caller: {
        uid: String(user.id || "").trim(),
        email: String(user.email || "").trim(),
        provider: String(appMetadata.provider || providers[0] || "").trim(),
        claims: user
      }
    };
  } catch (error) {
    console.warn("requireCaller failed", error);
    return {
      response: jsonResponse(req, 401, { ok: false, error: "Invalid auth token" })
    };
  }
}
