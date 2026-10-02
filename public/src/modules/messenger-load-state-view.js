function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderMessengerLoadError(message = "") {
  return `
    <div class="messenger-load-error" role="alert">
      <i class="bi bi-cloud-slash" aria-hidden="true"></i>
      <strong>Messages could not load</strong>
      <span>${escapeHtml(message || "Check your connection and try again.")}</span>
      <button type="button" data-action="messenger-retry-load">Try again</button>
    </div>
  `;
}
