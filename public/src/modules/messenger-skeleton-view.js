function shape(className = "", width = "") {
  const style = width ? ` style="--skeleton-width:${width}"` : "";
  return `<span class="messenger-skeleton-shape ${className}"${style} aria-hidden="true"></span>`;
}

export function renderMessengerRailSkeleton(count = 6) {
  const rows = Array.from({ length: count }, (_, index) => {
    const widths = ["68%", "54%", "62%"];
    const previewWidths = ["82%", "72%", "88%"];
    return `
      <div class="messenger-skeleton-conversation" aria-hidden="true">
        ${shape("is-avatar")}
        <span class="messenger-skeleton-copy">
          ${shape("is-line is-strong", widths[index % widths.length])}
          ${shape("is-line", previewWidths[index % previewWidths.length])}
        </span>
      </div>
    `;
  }).join("");
  return `<div class="messenger-skeleton-rail" aria-hidden="true">${rows}</div>`;
}

export function renderMessengerThreadHeaderSkeleton() {
  return `
    <div class="messenger-thread-head-shell messenger-thread-head-shell-skeleton" aria-hidden="true">
      ${shape("is-header-avatar")}
      <span class="messenger-skeleton-copy is-header-copy">
        ${shape("is-line is-strong", "148px")}
        ${shape("is-line is-small", "92px")}
      </span>
    </div>
  `;
}

export function renderMessengerThreadSkeleton() {
  const rows = [
    { self: false, lines: ["230px", "164px"] },
    { self: false, lines: ["276px"] },
    { self: true, lines: ["206px", "132px"] },
    { self: false, lines: ["250px", "184px"] },
    { self: true, lines: ["176px"] }
  ];
  return `
    <div class="messenger-message-feed messenger-message-feed-skeleton" aria-hidden="true">
      <div class="messenger-skeleton-day">${shape("is-line is-small", "74px")}</div>
      ${rows.map((row) => `
        <div class="messenger-skeleton-message ${row.self ? "is-self" : "is-peer"}">
          ${row.self ? "" : shape("is-message-avatar")}
          <span class="messenger-skeleton-message-copy">
            ${row.lines.map((width) => shape("is-message-line", width)).join("")}
          </span>
        </div>
      `).join("")}
    </div>
  `;
}

export function renderMessengerComposerSkeleton() {
  return `
    <div class="comms-composer messenger-composer-skeleton" aria-hidden="true">
      <section class="messenger-surface">
        <div class="messenger-compose-dock messenger-skeleton-compose-dock">
          <div class="messenger-skeleton-tools">
            ${shape("is-tool")}
          </div>
          ${shape("is-composer-line", "38%")}
          ${shape("is-send")}
        </div>
      </section>
    </div>
  `;
}

export function renderMessengerInfoSkeleton() {
  return `
    <aside class="messenger-info-pane messenger-info-skeleton" aria-label="Loading conversation details" aria-busy="true">
      <div class="messenger-skeleton-info-head" aria-hidden="true">
        ${shape("is-header-avatar")}
        <span class="messenger-skeleton-copy">
          ${shape("is-line is-strong", "112px")}
          ${shape("is-line is-small", "76px")}
        </span>
      </div>
      <div class="messenger-skeleton-info-section" aria-hidden="true">
        ${shape("is-line is-small", "58px")}
        ${shape("is-info-row")}
        ${shape("is-info-row")}
      </div>
      <div class="messenger-skeleton-info-section" aria-hidden="true">
        ${shape("is-line is-small", "46px")}
        ${shape("is-info-row")}
        ${shape("is-info-row")}
        ${shape("is-info-row")}
      </div>
    </aside>
  `;
}
