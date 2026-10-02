export async function runMessengerRequest(createRequest, options = {}) {
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || 15000);
  const Controller = options.AbortControllerClass || globalThis.AbortController;
  const controller = typeof Controller === "function" ? new Controller() : null;
  let timeoutId = 0;
  const timeout = new Promise((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      controller?.abort();
      reject(new Error("Messenger request timed out. Check your connection and try again."));
    }, timeoutMs);
  });
  try {
    let request = createRequest();
    if (controller && typeof request?.abortSignal === "function") {
      request = request.abortSignal(controller.signal);
    }
    const result = await Promise.race([request, timeout]);
    if (controller?.signal.aborted) {
      throw new Error("Messenger request timed out. Check your connection and try again.");
    }
    return result;
  } catch (error) {
    if (controller?.signal.aborted) {
      throw new Error("Messenger request timed out. Check your connection and try again.");
    }
    throw error;
  } finally {
    if (timeoutId) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}
