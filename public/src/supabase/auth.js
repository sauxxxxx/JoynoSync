import { initSupabase } from "./init.js";
import { getPublicAppUrl } from "./config.js";

function getAuthRedirectUrl(override = "") {
  const next = String(override || "").trim();
  return next || getPublicAppUrl();
}

function normalizeAuthUser(session) {
  const user = session?.user;
  if (!user) {
    return null;
  }

  const metadata = user.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {};
  const appMetadata = user.app_metadata && typeof user.app_metadata === "object" ? user.app_metadata : {};
  const accessToken = String(session?.access_token || "").trim();
  const displayName =
    String(metadata.full_name || metadata.name || metadata.user_name || user.email || "User").trim() || "User";
  const provider =
    String(appMetadata.provider || user.identities?.[0]?.provider || user.identities?.[0]?.identity_data?.provider || "").trim();

  return {
    id: user.id,
    uid: user.id,
    email: String(user.email || "").trim(),
    displayName,
    photoURL: String(metadata.avatar_url || "").trim(),
    provider,
    async getIdToken() {
      if (accessToken) {
        return accessToken;
      }
      const services = initSupabase();
      if (!services.configured) {
        return "";
      }
      const { data } = await services.client.auth.getSession();
      return String(data?.session?.access_token || "").trim();
    }
  };
}

export function observeAuth(callback) {
  const services = initSupabase();

  if (!services.configured) {
    callback(null);
    return () => {};
  }

  services.client.auth
    .getSession()
    .then(({ data, error }) => {
      if (error) {
        callback(null);
        return;
      }
      callback(normalizeAuthUser(data.session));
    })
    .catch(() => {
      callback(null);
    });

  const {
    data: { subscription }
  } = services.client.auth.onAuthStateChange((_event, session) => {
    callback(normalizeAuthUser(session));
  });

  return () => {
    subscription?.unsubscribe();
  };
}

export async function signInWithGoogle(options = {}) {
  const services = initSupabase();

  if (!services.configured) {
    throw new Error("Supabase is not configured.");
  }

  const redirectTo = getAuthRedirectUrl(options.redirectTo);
  const { error } = await services.client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo
    }
  });

  if (error) {
    throw error;
  }
}

export async function sendEmailOtp(email, options = {}) {
  const services = initSupabase();

  if (!services.configured) {
    throw new Error("Supabase is not configured.");
  }

  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error("Invite email is required.");
  }

  const authOptions = {
    shouldCreateUser: options.shouldCreateUser !== false
  };
  const redirectTo = String(options.redirectTo || "").trim();
  if (redirectTo) {
    authOptions.emailRedirectTo = getAuthRedirectUrl(redirectTo);
  }

  const { error } = await services.client.auth.signInWithOtp({
    email: normalizedEmail,
    options: authOptions
  });

  if (error) {
    throw error;
  }
}

export async function verifyEmailOtp(email, token) {
  const services = initSupabase();

  if (!services.configured) {
    throw new Error("Supabase is not configured.");
  }

  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedToken = String(token || "").trim();
  if (!normalizedEmail) {
    throw new Error("Email is required.");
  }
  if (!normalizedToken) {
    throw new Error("Verification code is required.");
  }

  const { data, error } = await services.client.auth.verifyOtp({
    email: normalizedEmail,
    token: normalizedToken,
    type: "email"
  });

  if (error) {
    throw error;
  }

  return normalizeAuthUser(data?.session || null);
}

export async function signInWithEmailPassword(email, password) {
  const services = initSupabase();

  if (!services.configured) {
    throw new Error("Supabase is not configured.");
  }

  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedPassword = String(password || "");
  if (!normalizedEmail) {
    throw new Error("Email is required.");
  }
  if (!normalizedPassword) {
    throw new Error("Password is required.");
  }

  const { data, error } = await services.client.auth.signInWithPassword({
    email: normalizedEmail,
    password: normalizedPassword
  });

  if (error) {
    throw error;
  }

  return normalizeAuthUser(data?.session || null);
}

export async function updateCurrentUserPassword(password) {
  const services = initSupabase();

  if (!services.configured) {
    throw new Error("Supabase is not configured.");
  }

  const normalizedPassword = String(password || "");
  if (!normalizedPassword) {
    throw new Error("Password is required.");
  }

  const { error } = await services.client.auth.updateUser({
    password: normalizedPassword
  });

  if (error) {
    throw error;
  }

  const { data: sessionData, error: sessionError } = await services.client.auth.getSession();
  if (sessionError) {
    throw sessionError;
  }

  return normalizeAuthUser(sessionData?.session || null);
}

export async function signOutCurrentUser() {
  const services = initSupabase();

  if (!services.configured) {
    return;
  }

  const { error } = await services.client.auth.signOut();
  if (error) {
    throw error;
  }
}
