const LOCAL_QA_SESSION_KEY = "joyno_local_qa_session_v1";

export function isLocalQaAvailable(locationLike = globalThis.location) {
  const hostname = String(locationLike?.hostname || "").trim().toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function isLocalQaSessionActive(
  locationLike = globalThis.location,
  storageLike = globalThis.sessionStorage
) {
  if (!isLocalQaAvailable(locationLike)) {
    return false;
  }
  try {
    return storageLike?.getItem(LOCAL_QA_SESSION_KEY) === "active";
  } catch (_error) {
    return false;
  }
}

export function startLocalQaSession(
  locationLike = globalThis.location,
  storageLike = globalThis.sessionStorage
) {
  if (!isLocalQaAvailable(locationLike)) {
    return false;
  }
  if (!storageLike || typeof storageLike.setItem !== "function") {
    return false;
  }
  try {
    storageLike.setItem(LOCAL_QA_SESSION_KEY, "active");
    return true;
  } catch (_error) {
    return false;
  }
}

export function endLocalQaSession(storageLike = globalThis.sessionStorage) {
  try {
    storageLike?.removeItem(LOCAL_QA_SESSION_KEY);
  } catch (_error) {
    // Blocked session storage already makes the local QA session inactive.
  }
}
