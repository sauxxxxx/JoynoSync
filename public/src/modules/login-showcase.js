export function renderLoginShowcase({ brandLabel, brandLogoUrl }) {
  return `
    <section class="login-showcase" aria-label="Joynosync product overview">
      <div class="login-showcase-brand">
        <img src="${brandLogoUrl}" alt="" aria-hidden="true" />
        <strong>${brandLabel}</strong>
      </div>

      <div class="login-showcase-intro">
        <h1>Your complete CRM<br />for growing businesses.</h1>
        <p>Manage leads, close deals, and build lasting<br class="login-showcase-copy-break" /> customer relationships — all in one place.</p>
      </div>

      <div class="login-product-preview" aria-hidden="true">
        <aside class="login-preview-sidebar">
          <div class="login-preview-logo">
            <img src="${brandLogoUrl}" alt="" />
            <strong>${brandLabel}</strong>
          </div>
          <nav class="login-preview-nav">
            <span class="is-active"><i class="bi bi-speedometer2"></i>Dashboard</span>
            <span><i class="bi bi-person"></i>Leads</span>
            <span><i class="bi bi-people"></i>Contacts</span>
            <span><i class="bi bi-building"></i>Accounts</span>
            <span><i class="bi bi-currency-dollar"></i>Deals</span>
            <span><i class="bi bi-calendar-check"></i>Activities</span>
            <span><i class="bi bi-calendar3"></i>Calendar</span>
            <span><i class="bi bi-bar-chart"></i>Reports</span>
            <span><i class="bi bi-send"></i>Campaigns</span>
            <span><i class="bi bi-person-gear"></i>Team</span>
          </nav>
          <div class="login-preview-user">
            <span class="login-preview-avatar">RU</span>
            <span><strong>Remar U.</strong><small>Administrator</small></span>
            <i class="bi bi-chevron-down"></i>
          </div>
        </aside>

        <div class="login-preview-main">
          <header class="login-preview-header">
            <div><h2>Dashboard</h2><p>Good morning, Remar! 👋</p></div>
            <span class="login-preview-date">May 1 – May 31, 2024 <i class="bi bi-chevron-down"></i></span>
          </header>

          <div class="login-preview-metrics">
            <article><small>Total Leads</small><strong>1,250</strong><em>↑ 18.5%</em><p>vs Apr 1 – Apr 30</p></article>
            <article><small>Deals in Pipeline</small><strong>346</strong><em>↑ 14.2%</em><p>vs Apr 1 – Apr 30</p></article>
            <article><small>Closed Deals</small><strong>98</strong><em>↑ 21.3%</em><p>vs Apr 1 – Apr 30</p></article>
            <article><small>Revenue</small><strong>₱1.45M</strong><em>↑ 17.7%</em><p>vs Apr 1 – Apr 30</p></article>
          </div>

          <div class="login-preview-charts">
            <article class="login-preview-chart-card login-preview-funnel-card">
              <h3>Pipeline Overview</h3>
              <div class="login-preview-funnel-content">
                <div class="login-preview-funnel">
                  <span></span><span></span><span></span><span></span>
                  <small>Total Deals<strong>346</strong></small>
                </div>
                <ul>
                  <li><i class="is-blue"></i>New <strong>120 <small>(34.7%)</small></strong></li>
                  <li><i class="is-teal"></i>Qualified <strong>98 <small>(28.3%)</small></strong></li>
                  <li><i class="is-gold"></i>Proposal <strong>76 <small>(22.0%)</small></strong></li>
                  <li><i class="is-orange"></i>Negotiation <strong>38 <small>(11.0%)</small></strong></li>
                  <li><i class="is-pink"></i>Closed Won <strong>14 <small>(4.0%)</small></strong></li>
                </ul>
              </div>
              <div class="login-preview-conversion"><span>Conversion Rate</span><strong>28.6%</strong></div>
            </article>

            <article class="login-preview-chart-card login-preview-line-card">
              <div class="login-preview-chart-head"><h3>Leads Over Time</h3><span>This Month <i class="bi bi-chevron-down"></i></span></div>
              <div class="login-preview-line-chart">
                <span class="chart-y y-one">1K</span><span class="chart-y y-two">750</span><span class="chart-y y-three">500</span><span class="chart-y y-four">250</span><span class="chart-y y-five">0</span>
                <svg viewBox="0 0 380 142" preserveAspectRatio="none" role="presentation">
                  <defs><linearGradient id="loginChartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f73ed" stop-opacity=".20"/><stop offset="1" stop-color="#2f73ed" stop-opacity="0"/></linearGradient></defs>
                  <path class="login-chart-grid" d="M28 15H374M28 44H374M28 73H374M28 102H374M28 131H374" />
                  <path class="login-chart-fill" d="M28 108L46 87L64 72L82 66L100 73L118 45L136 38L154 42L172 65L190 73L208 66L226 52L244 50L262 39L280 38L298 51L316 71L334 63L352 42L374 31L374 131L28 131Z" />
                  <path class="login-chart-line" d="M28 108L46 87L64 72L82 66L100 73L118 45L136 38L154 42L172 65L190 73L208 66L226 52L244 50L262 39L280 38L298 51L316 71L334 63L352 42L374 31" />
                </svg>
                <div class="login-chart-x"><span>May 1</span><span>May 8</span><span>May 15</span><span>May 22</span><span>May 31</span></div>
              </div>
            </article>
          </div>

          <article class="login-preview-activity">
            <div class="login-preview-activity-row is-head"><span>Activities</span><span>Type</span><span>Related To</span><span>Date</span><span>Owner</span><span>Status</span></div>
            <div class="login-preview-activity-row"><span>Follow up call</span><span>Call</span><span class="is-link">Acme Corporation</span><span>May 31, 2024 10:30 AM</span><span>John D.</span><span><em class="is-complete">Completed</em></span></div>
            <div class="login-preview-activity-row"><span>Product Demo</span><span>Meeting</span><span class="is-link">TechNova Inc.</span><span>May 31, 2024 02:00 PM</span><span>Jane S.</span><span><em class="is-scheduled">Scheduled</em></span></div>
            <div class="login-preview-activity-row"><span>Proposal Sent</span><span>Task</span><span class="is-link">Bright Solutions</span><span>May 30, 2024 11:15 AM</span><span>Remar U.</span><span><em class="is-complete">Completed</em></span></div>
            <div class="login-preview-activity-row"><span>Email Campaign</span><span>Email</span><span class="is-link">Marketing May 2024</span><span>May 30, 2024 09:00 AM</span><span>Mike L.</span><span><em class="is-sent">Sent</em></span></div>
          </article>
        </div>
      </div>

      <div class="login-showcase-features" aria-label="Product highlights">
        <article><span><i class="bi bi-people-fill"></i></span><div><strong>CRM</strong><p>Manage leads and<br />customer relationships</p></div></article>
        <article><span><i class="bi bi-filter"></i></span><div><strong>Sales Pipeline</strong><p>Track your deals and<br />close more efficiently</p></div></article>
        <article><span><i class="bi bi-bar-chart-fill"></i></span><div><strong>Analytics</strong><p>Gain insights and make<br />data-driven decisions</p></div></article>
      </div>

      <footer class="login-showcase-footer">
        <span class="login-system-status"><i></i>All systems operational</span>
        <span class="login-footer-divider" aria-hidden="true"></span>
        <span>© 2024 Joyno Inc. All rights reserved.</span>
      </footer>
    </section>
  `;
}
