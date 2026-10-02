import {
  ATTENDANCE_TIMEZONE_OPTIONS,
  PROFILE_PERMISSION_ACTIONS,
  PROFILE_PERMISSION_MODULES,
  PROFILE_SCOPE_OPTIONS
} from "../config/options.js";
import { normalizeSystemAppLabel, resolveBrandLogoUrl, SYSTEM_APP_NAME } from "../config/branding.js";
import {
  canManageTeamMembersByRole,
  isTeamMemberPendingInvite,
  normalizeTeamMemberStatus,
  resolveCurrentUserRole as resolveCurrentUserRoleCore
} from "../modules/profile-core.js";
import { escapeHtml } from "../utils/text.js";

function memberInitials(nameValue) {
  const name = String(nameValue || "").trim();
  if (!name) {
    return "TM";
  }
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return "TM";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
}

function normalizeScope(value) {
  const next = String(value || "").trim().toLowerCase();
  return PROFILE_SCOPE_OPTIONS.includes(next) ? next : "own";
}

function normalizePermissions(member) {
  const role = String(member?.role || "").trim().toLowerCase();
  const source = member?.permissions && typeof member.permissions === "object" ? member.permissions : {};
  const template = {};

  PROFILE_PERMISSION_MODULES.forEach((module) => {
    const current = source[module.id] && typeof source[module.id] === "object" ? source[module.id] : {};
    template[module.id] = {};
    PROFILE_PERMISSION_ACTIONS.forEach((action) => {
      if (Object.prototype.hasOwnProperty.call(current, action)) {
        template[module.id][action] = Boolean(current[action]);
        return;
      }
      if (role === "owner") {
        template[module.id][action] = true;
        return;
      }
      if (role === "manager") {
        template[module.id][action] = action !== "delete";
        return;
      }
      if (role === "member") {
        template[module.id][action] = action === "view" || action === "create" || action === "edit";
        return;
      }
      template[module.id][action] = action === "view";
    });
  });

  return template;
}

function isCurrentUserOwner(data) {
  return String(resolveCurrentUserRoleCore(data) || "")
    .trim()
    .toLowerCase() === "owner";
}

function canManageOwnerTeamMember(member, data) {
  const targetRole = String(member?.role || "")
    .trim()
    .toLowerCase();
  return targetRole !== "owner" || isCurrentUserOwner(data);
}

function getAssignableTeamRoles(member, data) {
  if (isCurrentUserOwner(data)) {
    return ["Owner", "Admin", "Manager", "Member", "Guest"];
  }
  const targetRole = String(member?.role || "").trim();
  if (targetRole === "Owner") {
    return ["Owner"];
  }
  return ["Admin", "Manager", "Member", "Guest"];
}

function normalizeTeamMemberIdentity(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function teamMemberMatchesRecord(member, recordId, recordName) {
  const memberId = normalizeTeamMemberIdentity(member?.id);
  const nextRecordId = normalizeTeamMemberIdentity(recordId);
  if (memberId && nextRecordId && memberId === nextRecordId) {
    return true;
  }
  const memberName = normalizeTeamMemberIdentity(member?.name);
  const nextRecordName = normalizeTeamMemberIdentity(recordName);
  return Boolean(memberName && nextRecordName && memberName === nextRecordName);
}

function teamMemberLastActiveLabel(member) {
  const lastLogin = Date.parse(String(member?.lastLoginAt || ""));
  if (Number.isFinite(lastLogin)) {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(lastLogin));
  }
  const inviteSent = Date.parse(String(member?.inviteLastSentAt || member?.invitedAt || ""));
  if (normalizeTeamMemberStatus(member?.status) === "Pending Invite" && Number.isFinite(inviteSent)) {
    return `Invited ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(inviteSent))}`;
  }
  return "Never";
}

function teamMemberRoleBadge(value) {
  const role = String(value || "Member").trim() || "Member";
  const roleClass = role.toLowerCase().replaceAll(" ", "-");
  return `<span class="status-chip role-${roleClass}">${escapeHtml(role)}</span>`;
}

function teamMemberStatusBadge(value) {
  const status = normalizeTeamMemberStatus(value || "Active");
  const tone = status.toLowerCase().replaceAll(" ", "-");
  return `<span class="team-status-chip is-${tone}">${escapeHtml(status)}</span>`;
}

function formatTeamMemberMoney(value, currency = "USD") {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "No pipeline value";
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: String(currency || "USD").trim() || "USD",
      maximumFractionDigits: 0
    }).format(numeric);
  } catch {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0
    }).format(numeric);
  }
}

function formatTeamMemberShortDate(value, emptyLabel = "No date") {
  const raw = String(value || "").trim();
  if (!raw) {
    return emptyLabel;
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    return emptyLabel;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(new Date(parsed));
}

function formatTeamMemberDateTime(value, emptyLabel = "No activity yet") {
  const raw = String(value || "").trim();
  if (!raw) {
    return emptyLabel;
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    return emptyLabel;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(parsed));
}

function teamMemberInfoText(icon, text, className = "lead-profile-inline-meta-item") {
  const safeText = String(text || "").trim();
  if (!safeText) {
    return "";
  }
  return `
    <span class="${escapeHtml(className)}">
      <i class="bi ${escapeHtml(icon)}" aria-hidden="true"></i>
      <span>${escapeHtml(safeText)}</span>
    </span>
  `;
}

function teamMemberTaskStatusClass(value) {
  return String(value || "New")
    .trim()
    .toLowerCase()
    .replaceAll(" ", "-") || "new";
}

function teamMemberDealStageClass(value) {
  const normalized = String(value || "Prospecting").trim().toLowerCase();
  if (normalized === "closed won" || normalized === "won") {
    return "stage-won";
  }
  if (normalized === "closed lost" || normalized === "lost") {
    return "stage-lost";
  }
  return `stage-${normalized.replaceAll(" ", "-") || "prospecting"}`;
}

function buildTeamMemberLeadRows(leads, options = {}) {
  const limit = Math.max(0, Number(options.limit || 5) || 0);
  const emptyLabel = String(options.emptyLabel || "No active leads assigned right now.").trim();
  if (!Array.isArray(leads) || !leads.length) {
    return `<p class='lead-profile-empty'>${escapeHtml(emptyLabel)}</p>`;
  }
  const rows = limit > 0 ? leads.slice(0, limit) : leads;
  return rows
    .map((lead) => {
      const companyLabel = String(lead.company || "").trim();
      const sourceLabel = String(lead.source || "").trim();
      const statusKey = teamMemberTaskStatusClass(lead.status || "New");
      const followUpLabel = String(lead.nextFollowUp || "").trim()
        ? `Follow-up ${formatTeamMemberShortDate(lead.nextFollowUp)}`
        : "No follow-up set";
      return `
        <article class="lead-profile-list-row team-member-profile-row" data-lead-open="${escapeHtml(lead.id)}">
          <div class="lead-profile-list-main">
            <p class="lead-profile-list-title">${escapeHtml(lead.name || "Lead")}</p>
            <p class="lead-profile-list-meta">
              ${teamMemberInfoText("bi-building", companyLabel || "No company")}
              ${teamMemberInfoText("bi-calendar3", followUpLabel)}
            </p>
            ${sourceLabel ? `<p class="lead-profile-list-body">${escapeHtml(sourceLabel)}</p>` : ""}
          </div>
          <span class="status-chip status-${escapeHtml(statusKey)}">${escapeHtml(lead.status || "New")}</span>
        </article>
      `;
    })
    .join("");
}

function buildTeamMemberDealRows(deals, options = {}) {
  const limit = Math.max(0, Number(options.limit || 5) || 0);
  const emptyLabel = String(options.emptyLabel || "No open deals owned right now.").trim();
  if (!Array.isArray(deals) || !deals.length) {
    return `<p class='lead-profile-empty'>${escapeHtml(emptyLabel)}</p>`;
  }
  const rows = limit > 0 ? deals.slice(0, limit) : deals;
  return rows
    .map((deal) => {
      const accountLabel = String(deal.account || "").trim();
      const stageLabel = String(deal.stage || "Prospecting").trim();
      const normalizedStageLabel =
        stageLabel === "Won" ? "Closed Won" : stageLabel === "Lost" ? "Closed Lost" : stageLabel || "Prospecting";
      const closeLabel = String(deal.closeDate || "").trim()
        ? `Closes ${formatTeamMemberShortDate(deal.closeDate)}`
        : "No close date";
      const valueLabel = formatTeamMemberMoney(deal.value, deal.currency || "USD");
      return `
        <article class="lead-profile-list-row" data-deal-open="${escapeHtml(deal.id)}">
          <div class="lead-profile-list-main">
            <p class="lead-profile-list-title">${escapeHtml(deal.name || "Deal")}</p>
            <p class="lead-profile-list-meta">
              ${teamMemberInfoText("bi-building", accountLabel || "No account")}
              ${teamMemberInfoText("bi-calendar3", closeLabel)}
            </p>
            <p class="lead-profile-list-body">${escapeHtml(valueLabel)}</p>
          </div>
          <span class="status-chip ${escapeHtml(teamMemberDealStageClass(stageLabel))}">${escapeHtml(normalizedStageLabel)}</span>
        </article>
      `;
    })
    .join("");
}

function buildTeamMemberTaskRows(tasks, options = {}) {
  const limit = Math.max(0, Number(options.limit || 6) || 0);
  const emptyLabel = String(options.emptyLabel || "No open tasks assigned right now.").trim();
  if (!Array.isArray(tasks) || !tasks.length) {
    return `<p class='lead-profile-empty'>${escapeHtml(emptyLabel)}</p>`;
  }
  const rows = limit > 0 ? tasks.slice(0, limit) : tasks;
  return rows
    .map((task) => {
      const dueLabel = String(task.dueDate || "").trim() ? formatTeamMemberShortDate(task.dueDate) : "No due date";
      const relatedLabel = String(task.accountName || task.linkLabel || "").trim();
      return `
        <article class="lead-profile-list-row lead-profile-task-row" data-task-open="${escapeHtml(task.id)}">
          <div class="lead-profile-list-main">
            <p class="lead-profile-list-title">${escapeHtml(task.title || "Task")}</p>
            <p class="lead-profile-list-meta">
              ${teamMemberInfoText("bi-calendar3", `Due ${dueLabel}`)}
              ${relatedLabel ? teamMemberInfoText("bi-link-45deg", relatedLabel) : ""}
            </p>
          </div>
          <span class="status-chip status-${escapeHtml(teamMemberTaskStatusClass(task.status || "New"))}">${escapeHtml(task.status || "New")}</span>
        </article>
      `;
    })
    .join("");
}

function buildTeamMemberActivityRows(items, options = {}) {
  const limit = Math.max(0, Number(options.limit || 8) || 0);
  const emptyLabel = String(options.emptyLabel || "No recent activity yet.").trim();
  if (!Array.isArray(items) || !items.length) {
    return `<p class='lead-profile-empty'>${escapeHtml(emptyLabel)}</p>`;
  }
  const rows = limit > 0 ? items.slice(0, limit) : items;
  return `
    <div class="team-member-activity-list">
      ${rows
        .map(
          (item) => `
            <article class="team-member-activity-row">
              <span class="team-member-activity-icon" aria-hidden="true"><i class="bi ${escapeHtml(item.icon || "bi-clock-history")}"></i></span>
              <div class="team-member-activity-main">
                <p class="team-member-activity-title">${escapeHtml(item.title || "Activity")}</p>
                <p class="team-member-activity-meta">${escapeHtml(item.meta || "")}</p>
              </div>
              <time class="team-member-activity-time">${escapeHtml(formatTeamMemberDateTime(item.timestamp || ""))}</time>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function collectTeamMemberActivity(member, leads, deals, tasks) {
  const activity = [];
  const pushActivity = (timestamp, title, meta, icon) => {
    const rawTimestamp = String(timestamp || "").trim();
    const parsed = Date.parse(rawTimestamp);
    if (!rawTimestamp || !Number.isFinite(parsed)) {
      return;
    }
    activity.push({
      timestamp: rawTimestamp,
      parsed,
      title,
      meta,
      icon
    });
  };

  pushActivity(member?.lastLoginAt, "Signed in to the workspace", member?.email || "Workspace access confirmed", "bi-box-arrow-in-right");
  pushActivity(
    member?.inviteLastSentAt || member?.invitedAt,
    isTeamMemberPendingInvite(member?.status) ? "Invite is active" : "Invite was sent",
    member?.email || "Invitation delivered to member email",
    "bi-envelope-paper"
  );
  pushActivity(
    member?.updatedAt,
    "Member profile updated",
    member?.updatedBy ? `Updated by ${member.updatedBy}` : "Workspace settings changed",
    "bi-shield-check"
  );

  (Array.isArray(leads) ? leads : []).forEach((lead) => {
    pushActivity(
      lead?.updatedAt || lead?.createdAt,
      "Lead ownership updated",
      `${lead?.name || "Lead"}${lead?.status ? ` · ${lead.status}` : ""}`,
      "bi-person-lines-fill"
    );
  });

  (Array.isArray(deals) ? deals : []).forEach((deal) => {
    pushActivity(
      deal?.updatedAt || deal?.createdAt,
      "Deal pipeline updated",
      `${deal?.name || "Deal"}${deal?.stage ? ` · ${deal.stage}` : ""}`,
      "bi-briefcase"
    );
  });

  (Array.isArray(tasks) ? tasks : []).forEach((task) => {
    pushActivity(
      task?.updatedAt || task?.createdAt,
      task?.status === "Completed" ? "Task completed" : "Task updated",
      `${task?.title || "Task"}${task?.status ? ` · ${task.status}` : ""}`,
      "bi-check2-square"
    );
  });

  return activity.sort((left, right) => right.parsed - left.parsed);
}

export function renderLoginView(data, context) {
  const workspaceName = String(data.workspace?.name || SYSTEM_APP_NAME).trim() || SYSTEM_APP_NAME;
  const brandLabel = normalizeSystemAppLabel(data.workspace?.appLabel);
  const brandLogoUrl = resolveBrandLogoUrl(data.workspace?.logoUrl);
  const signedInUser = context.signedInUser && typeof context.signedInUser === "object" ? context.signedInUser : null;
  const signedInEmail = String(signedInUser?.email || "").trim();
  const draftEmail = String(context.loginEmailDraft || signedInEmail || "").trim().toLowerCase();
  const passwordDraft = String(context.loginPasswordDraft || "").trim();
  const otpDraft = String(context.loginOtpDraft || "").trim();
  const otpSentTo = String(context.loginOtpSentTo || "").trim().toLowerCase();
  const pendingPasswordSetupEmail = String(context.loginPendingPasswordSetupEmail || "").trim().toLowerCase();
  const passwordSetupDraft = String(context.loginPasswordSetupDraft || "").trim();
  const passwordSetupConfirmDraft = String(context.loginPasswordSetupConfirmDraft || "").trim();
  const loginViewMode = String(context.loginViewMode || "").trim().toLowerCase() === "signup" ? "signup" : "signin";
  const loginEmailLookupStatus =
    context.loginEmailLookupStatus && typeof context.loginEmailLookupStatus === "object"
      ? context.loginEmailLookupStatus
      : { loading: false, email: "", recognized: false, active: false, pending: false, error: "" };
  const authActionPending = String(context.authActionPending || "").trim();
  const authAccessState = String(context.authAccessState || "").trim();
  const accessMessage = String(context.authAccessMessage || "").trim();
  const postLoginRouteLabel = String(context.postLoginRouteLabel || "").trim();
  const localQaAvailable = Boolean(context.localQaAvailable);
  const isWorkspaceSignInPending = Boolean(signedInUser) && authAccessState === "loading";
  const signedInProvider = String(signedInUser?.provider || "").trim().toLowerCase();
  const isGooglePending =
    authActionPending === "google-sign-in" || (isWorkspaceSignInPending && signedInProvider === "google");
  const isPasswordPending =
    authActionPending === "email-password" || (isWorkspaceSignInPending && signedInProvider !== "google");
  const isOtpSendPending = authActionPending === "login-send-otp";
  const isOtpVerifyPending = authActionPending === "login-verify-otp";
  const isPasswordSetupPending = authActionPending === "login-setup-password";
  const isAnyEmailPending = isPasswordPending || isOtpSendPending || isOtpVerifyPending || isPasswordSetupPending;
  const isBlocked = Boolean(signedInUser) && authAccessState === "blocked";
  const isSessionChecking = Boolean(context.authBootstrapPending && !signedInUser);

  if (isSessionChecking) {
    return {
      title: "Sign In",
      subtitle: "Workspace access",
      showWaitingPanel: false,
      html: `
        <section class="auth-login-view is-bootstrapping" aria-busy="true">
          <div class="auth-login-bootstrap" role="status" aria-live="polite">
            <div class="auth-login-identity">
              <img src="${escapeHtml(brandLogoUrl)}" alt="" aria-hidden="true" />
              <strong>${escapeHtml(brandLabel)}</strong>
            </div>
            <span class="auth-login-bootstrap-spinner" aria-hidden="true"></span>
            <span class="sr-only">Opening your workspace</span>
          </div>
        </section>
      `
    };
  }

  const lookupEmail = String(loginEmailLookupStatus.email || "").trim().toLowerCase();
  const isLookupMatch = Boolean(draftEmail && lookupEmail && draftEmail === lookupEmail);
  const isActiveWorkspaceEmail = Boolean(!signedInUser && isLookupMatch && loginEmailLookupStatus.active);
  const isPendingInviteEmail = Boolean(!signedInUser && isLookupMatch && loginEmailLookupStatus.pending);
  const nextRouteCopy = postLoginRouteLabel
    ? `After sign-in, you'll return to ${postLoginRouteLabel}.`
    : `After sign-in, you'll land in ${workspaceName}.`;
  const panelStage = pendingPasswordSetupEmail ? "setup" : otpSentTo ? "otp" : loginViewMode === "signup" ? "signup" : "signin";
  const isSignupMode = panelStage !== "signin";
  const disablePrimaryForms = isGooglePending || isAnyEmailPending;
  const cardClassName = `auth-login-card${isSignupMode ? " is-signup-mode" : ""}`;
  let panelTitle = isSignupMode ? "Set up your account" : `Sign in to ${brandLabel}`;
  let panelSubtitle = isSignupMode
    ? `Use the invited email for ${workspaceName} to verify access and finish setup.`
    : "Continue to your workspace.";

  let panelBody = "";

  if (isBlocked) {
    panelTitle = "Workspace access is not active";
    panelSubtitle = "This account signed in successfully, but there is no active workspace membership yet.";
    panelBody = `
      <div class="auth-login-status is-danger">
        <div class="auth-login-status-icon"><i class="bi bi-shield-lock" aria-hidden="true"></i></div>
        <div>
          <p class="auth-login-status-title">Workspace access is not active</p>
          <p>${escapeHtml(accessMessage || `No active workspace membership was found for ${signedInEmail}.`)}</p>
        </div>
      </div>
      <div class="auth-login-account">
        <span class="auth-login-account-label">Signed in account</span>
        <strong>${escapeHtml(signedInEmail || "Unknown account")}</strong>
      </div>
      <div class="auth-login-actions auth-login-actions-compact">
        <button class="btn btn-light" type="button" data-action="auth-sign-out">Sign Out</button>
      </div>
    `;
  } else if (panelStage === "setup") {
    panelTitle = "Create your password";
    panelSubtitle = "Your email is verified. Finish setup once, then use email and password the next time you log in.";
    panelBody = `
      <div class="auth-login-status is-success">
        <div class="auth-login-status-icon"><i class="bi bi-shield-check" aria-hidden="true"></i></div>
        <div>
          <p class="auth-login-status-title">Email verified</p>
          <p>Create your password for <strong>${escapeHtml(pendingPasswordSetupEmail)}</strong>. After that, email sign-in will use your password instead of a code.</p>
        </div>
      </div>
      <div class="auth-login-account">
        <span class="auth-login-account-label">Verified Email</span>
        <strong>${escapeHtml(pendingPasswordSetupEmail)}</strong>
      </div>
      <form id="loginPasswordSetupForm" class="auth-login-form">
        ${renderAuthPasswordField({
          fieldId: "loginPasswordSetupInput",
          label: "Create password",
          name: "password",
          value: passwordSetupDraft,
          placeholder: "At least 8 characters",
          autocomplete: "new-password",
          extraAttributes: 'data-login-password-setup-input="password"',
          disabled: isPasswordSetupPending
        })}
        ${renderAuthPasswordField({
          fieldId: "loginPasswordSetupConfirmInput",
          label: "Confirm password",
          name: "confirmPassword",
          value: passwordSetupConfirmDraft,
          placeholder: "Repeat your password",
          autocomplete: "new-password",
          extraAttributes: 'data-login-password-setup-input="confirm"',
          disabled: isPasswordSetupPending
        })}
        <button class="btn btn-light auth-login-magic" type="submit" ${isPasswordSetupPending ? "disabled" : ""}>
          ${isPasswordSetupPending ? "Saving Password..." : "Save Password and Continue"}
        </button>
      </form>
      <div class="auth-login-secondary-row">
        <button class="auth-login-link" type="button" data-action="auth-sign-out" ${isPasswordSetupPending ? "disabled" : ""}>
          Start over with a different account
        </button>
      </div>
      <div class="auth-login-note">
        <p>${escapeHtml(nextRouteCopy)}</p>
      </div>
    `;
  } else if (panelStage === "otp") {
    panelTitle = "Verify your email";
    panelSubtitle = "Enter the code we sent to the invited email, then you will create your password.";
    panelBody = `
      <div class="auth-login-status is-success">
        <div class="auth-login-status-icon"><i class="bi bi-envelope-check" aria-hidden="true"></i></div>
        <div>
          <p class="auth-login-status-title">Check your inbox</p>
          <p>We sent a one-time code to <strong>${escapeHtml(otpSentTo)}</strong>. Enter it below to verify this email.</p>
        </div>
      </div>
      <form id="loginOtpVerifyForm" class="auth-login-form">
        <label class="auth-login-field" for="loginOtpInput">
          <span>Verification code</span>
          <input
            id="loginOtpInput"
            class="auth-login-input auth-login-code-input"
            name="token"
            type="text"
            value="${escapeHtml(otpDraft)}"
            placeholder="123456"
            inputmode="numeric"
            autocomplete="one-time-code"
            data-login-otp-input
            required
            ${isOtpVerifyPending ? "disabled" : ""}
          />
        </label>
        <button class="btn btn-light auth-login-magic" type="submit" ${isOtpVerifyPending ? "disabled" : ""}>
          ${isOtpVerifyPending ? "Verifying..." : "Verify Code"}
        </button>
      </form>
      <div class="auth-login-secondary-row">
        <button class="auth-login-link" type="button" data-action="login-resend-otp" ${isOtpSendPending || isOtpVerifyPending ? "disabled" : ""}>
          ${isOtpSendPending ? "Sending another code..." : "Resend code"}
        </button>
        <button class="auth-login-link" type="button" data-action="login-cancel-otp" ${isOtpSendPending || isOtpVerifyPending ? "disabled" : ""}>
          Back to signup
        </button>
      </div>
      <div class="auth-login-note">
        <p>Use the code to verify your invited email, then set or reset your password.</p>
        <p>${escapeHtml(nextRouteCopy)}</p>
      </div>
    `;
  } else if (panelStage === "signup") {
    panelBody = `
      ${
        isPendingInviteEmail
          ? `
            <div class="auth-login-status is-info">
              <div class="auth-login-status-icon"><i class="bi bi-envelope-open" aria-hidden="true"></i></div>
              <div>
                <p class="auth-login-status-title">Invite found</p>
                <p><strong>${escapeHtml(draftEmail)}</strong> is ready for account setup. We will send a verification code next.</p>
              </div>
            </div>
          `
          : ""
      }
      ${
        isLookupMatch && loginEmailLookupStatus.error
          ? `
            <div class="auth-login-status is-danger">
              <div class="auth-login-status-icon"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i></div>
              <div>
                <p class="auth-login-status-title">We couldn't verify that invite yet</p>
                <p>${escapeHtml(loginEmailLookupStatus.error)}</p>
              </div>
            </div>
          `
          : ""
      }
      <form id="loginSignupStartForm" class="auth-login-form">
          <label class="auth-login-field" for="loginSignupEmailInput">
            <span>Invited email address</span>
            <input
              id="loginSignupEmailInput"
              class="auth-login-input"
              name="email"
              type="text"
              value="${escapeHtml(draftEmail)}"
              placeholder="name@company.com"
              inputmode="email"
              autocomplete="email"
              autocapitalize="none"
              spellcheck="false"
              data-login-email-input
              required
              ${disablePrimaryForms ? "disabled" : ""}
            />
          </label>
        <button class="btn btn-light auth-login-magic" type="submit" ${disablePrimaryForms ? "disabled" : ""}>
          ${isOtpSendPending ? "Sending Code..." : isLookupMatch && loginEmailLookupStatus.error ? "Try Again" : "Send Verification Code"}
        </button>
      </form>
      <div class="auth-login-secondary-row">
        <p class="auth-login-switch-copy">Already have an account?</p>
        <button class="auth-login-link" type="button" data-action="login-switch-signin" ${disablePrimaryForms ? "disabled" : ""}>
          Log in
        </button>
      </div>
      <div class="auth-login-note">
        <p>Only invited workspace emails can create an account here.</p>
      </div>
    `;
  } else {
    panelBody = `
      <div class="auth-login-actions">
        <button class="btn btn-accent auth-login-google" type="button" data-action="auth-sign-in" ${disablePrimaryForms ? "disabled" : ""}>
          ${
            isGooglePending
              ? '<span class="auth-signin-spinner" aria-hidden="true"></span><span>Signing in with Google…</span>'
              : '<span class="auth-google-mark" aria-hidden="true">G</span><span>Continue with Google</span>'
          }
        </button>
        <div class="auth-login-divider" aria-hidden="true">
          <span></span>
          <small>or</small>
          <span></span>
        </div>
        <form id="loginPasswordForm" class="auth-login-form">
          <label class="auth-login-field" for="loginEmailInput">
            <span>Email address</span>
            <input
              id="loginEmailInput"
              class="auth-login-input"
              name="email"
              type="text"
              value="${escapeHtml(draftEmail)}"
              placeholder="name@company.com"
              inputmode="email"
              autocomplete="email"
              autocapitalize="none"
              spellcheck="false"
              data-login-email-input
              required
              ${disablePrimaryForms ? "disabled" : ""}
            />
          </label>
          ${renderAuthPasswordField({
            fieldId: "loginPasswordInput",
            label: "Password",
            name: "password",
            value: passwordDraft,
            placeholder: "Enter your password",
            autocomplete: "current-password",
            extraAttributes: "data-login-password-input",
            disabled: disablePrimaryForms
          })}
          <div class="auth-login-options">
            <button class="auth-login-link" type="button" data-action="login-forgot-password">Forgot password?</button>
          </div>
          <button class="btn btn-light auth-login-magic" type="submit" ${disablePrimaryForms ? "disabled" : ""}>
            ${
              isPasswordPending
                ? '<span class="auth-signin-spinner" aria-hidden="true"></span><span>Signing in…</span>'
                : "Continue with email"
            }
          </button>
        </form>
        <div class="auth-login-secondary-row">
          <p class="auth-login-switch-copy">Have a workspace invitation?</p>
          <button class="auth-login-link" type="button" data-action="login-switch-signup" ${disablePrimaryForms ? "disabled" : ""}>
            Set up account
          </button>
        </div>
        <div class="auth-login-note">
          <p>Need access? Contact your workspace administrator.</p>
        </div>
      </div>
    `;
  }

  return {
    title: isSignupMode ? "Set Up Account" : "Sign In",
    subtitle: "Workspace access",
    showWaitingPanel: false,
    html: `
      <section class="auth-login-view">
        <div class="auth-login-shell">
          <article class="${cardClassName}">
            <div class="auth-login-form-panel">
              <div class="auth-login-identity">
                <img src="${escapeHtml(brandLogoUrl)}" alt="" aria-hidden="true" />
                <strong>${escapeHtml(brandLabel)}</strong>
              </div>
              <div class="auth-login-card-head">
                <h3>${escapeHtml(panelTitle)}</h3>
                <p>${escapeHtml(panelSubtitle)}</p>
              </div>
              ${panelBody}
              <div class="auth-login-support">
                <i class="bi bi-question-circle" aria-hidden="true"></i>
                <div>
                  <strong>Need help accessing your workspace?</strong>
                  ${
                    localQaAvailable
                      ? `<button type="button" data-action="local-qa-sign-in">Open local QA workspace</button>`
                      : "<span>Contact your administrator.</span>"
                  }
                </div>
              </div>
            </div>
          </article>
        </div>
      </section>
    `
  };
}

function renderAuthPasswordField({
  fieldId,
  label,
  name,
  value,
  placeholder,
  autocomplete,
  extraAttributes = "",
  disabled = false
}) {
  return `
    <label class="auth-login-field" for="${escapeHtml(fieldId)}">
      <span>${escapeHtml(label)}</span>
      <div class="auth-password-shell">
        <input
          id="${escapeHtml(fieldId)}"
          class="auth-login-input has-password-toggle"
          name="${escapeHtml(name)}"
          type="password"
          value="${escapeHtml(value)}"
          placeholder="${escapeHtml(placeholder)}"
          autocomplete="${escapeHtml(autocomplete)}"
          ${extraAttributes}
          required
          ${disabled ? "disabled" : ""}
        />
        <button
          class="auth-password-toggle"
          type="button"
          data-action="auth-toggle-password-visibility"
          data-password-toggle-target="${escapeHtml(fieldId)}"
          aria-label="Show password"
          title="Show password"
          ${disabled ? "disabled" : ""}
        >
          <i class="bi bi-eye" aria-hidden="true"></i>
        </button>
      </div>
    </label>
  `;
}

export function renderInviteAcceptance(_data, context) {
  const invite = context.inviteContext && typeof context.inviteContext === "object" ? context.inviteContext : null;
  const inviteId = String(invite?.inviteId || "").trim();
  const token = String(invite?.token || "").trim();
  const email = String(invite?.email || "").trim();
  const name = String(invite?.name || "").trim();
  const role = String(invite?.role || "Member").trim() || "Member";
  const team = String(invite?.team || "General").trim() || "General";
  const workspace = String(invite?.workspace || "Workspace").trim() || "Workspace";
  const invitedBy = String(invite?.invitedBy || "Admin").trim() || "Admin";
  const inviteLookupStatus =
    context.inviteLookupStatus && typeof context.inviteLookupStatus === "object"
      ? context.inviteLookupStatus
      : { loading: false, error: "" };
  const signedInEmail = String(context.signedInUser?.email || "").trim().toLowerCase();
  const invitedEmail = String(email || "").trim().toLowerCase();
  const isSignedIn = Boolean(signedInEmail);
  const wrongEmail = isSignedIn && invitedEmail && signedInEmail !== invitedEmail;
  const isProcessing = isSignedIn && !wrongEmail && context.authAccessState === "loading";
  const routeMessage = String(context.inviteRouteMessage || "").trim();
  const routeLink = String(context.inviteRouteLink || "").trim();
  const inviteOtpDraft = String(context.inviteOtpDraft || "").trim();
  const inviteOtpSentTo = String(context.inviteOtpSentTo || "").trim().toLowerCase();
  const invitePendingPasswordSetupEmail = String(context.invitePendingPasswordSetupEmail || "").trim().toLowerCase();
  const invitePasswordSetupDraft = String(context.invitePasswordSetupDraft || "").trim();
  const invitePasswordSetupConfirmDraft = String(context.invitePasswordSetupConfirmDraft || "").trim();
  const authActionPending = String(context.authActionPending || "").trim();
  const isInviteOtpSendPending = authActionPending === "invite-send-otp";
  const isInviteOtpVerifyPending = authActionPending === "invite-verify-otp";
  const isInvitePasswordSetupPending = authActionPending === "invite-setup-password";
  const hasValidInvite = Boolean(token && invitedEmail);
  const isLookupLoading = Boolean(inviteId && !hasValidInvite && inviteLookupStatus.loading);
  const lookupError = String(!hasValidInvite && inviteId ? inviteLookupStatus.error || routeMessage : "").trim();
  const processingMarkup = `
    <div class="invite-accept-processing">
      <span class="invite-accept-spinner" aria-hidden="true"></span>
      <div>
        <p class="invite-accept-processing-title">Signing you in...</p>
        <p class="task-meta">Completing your workspace access. You will be redirected automatically.</p>
      </div>
    </div>
  `;

  let bodyMarkup = `
    <p>This invite is not valid. Ask your workspace administrator for a new invite link.</p>
    <div class="empty-state-actions">
      <button class="btn btn-light" type="button" data-action="invite-sign-out">Back</button>
    </div>
  `;

  if (isLookupLoading) {
    bodyMarkup = `
      <p>Loading your workspace invite.</p>
      <div class="invite-accept-processing">
        <span class="invite-accept-spinner" aria-hidden="true"></span>
        <div>
          <p class="invite-accept-processing-title">Checking invite details...</p>
          <p class="task-meta">This usually takes a second.</p>
        </div>
      </div>
    `;
  } else if (hasValidInvite) {
    bodyMarkup = `
      <p>Accept your invite to join <strong>${escapeHtml(workspace)}</strong>.</p>
      <div class="profile-audit-grid invite-accept-grid">
        <p><span>Invited Email</span><strong>${escapeHtml(email)}</strong></p>
        <p><span>Role</span><strong>${escapeHtml(role)}</strong></p>
        <p><span>Team</span><strong>${escapeHtml(team)}</strong></p>
        <p><span>Invited By</span><strong>${escapeHtml(invitedBy)}</strong></p>
      </div>
      ${
        routeMessage
          ? `<p class="invite-accept-message">${escapeHtml(routeMessage)}</p>`
          : ""
      }
      ${
        routeLink
          ? `
            <div class="invite-accept-link-shell">
              <p class="task-meta">Invite link</p>
              <div class="invite-accept-link-row">
                <input type="text" readonly value="${escapeHtml(routeLink)}" aria-label="Invite link" />
                <button class="btn btn-light" type="button" data-action="invite-copy-link">Copy Link</button>
              </div>
            </div>
          `
          : ""
      }
      ${
        wrongEmail
          ? `
            <div class="empty-state-actions">
              <button class="btn btn-light" type="button" data-action="invite-sign-out">Sign Out</button>
            </div>
          `
          : invitePendingPasswordSetupEmail
            ? `
              <div class="auth-login-status is-success">
                <div class="auth-login-status-icon"><i class="bi bi-shield-check" aria-hidden="true"></i></div>
                <div>
                  <p class="auth-login-status-title">Email verified</p>
                  <p>Create a password for <strong>${escapeHtml(invitePendingPasswordSetupEmail)}</strong>. After this, you can sign in with email and password.</p>
                </div>
              </div>
              <form id="invitePasswordSetupForm" class="auth-login-form invite-accept-form">
                ${renderAuthPasswordField({
                  fieldId: "invitePasswordSetupInput",
                  label: "Create password",
                  name: "password",
                  value: invitePasswordSetupDraft,
                  placeholder: "At least 8 characters",
                  autocomplete: "new-password",
                  extraAttributes: 'data-invite-password-setup-input="password"',
                  disabled: isInvitePasswordSetupPending
                })}
                ${renderAuthPasswordField({
                  fieldId: "invitePasswordSetupConfirmInput",
                  label: "Confirm password",
                  name: "confirmPassword",
                  value: invitePasswordSetupConfirmDraft,
                  placeholder: "Repeat your password",
                  autocomplete: "new-password",
                  extraAttributes: 'data-invite-password-setup-input="confirm"',
                  disabled: isInvitePasswordSetupPending
                })}
                <button class="btn btn-light auth-login-magic" type="submit" ${isInvitePasswordSetupPending ? "disabled" : ""}>
                  ${isInvitePasswordSetupPending ? "Saving Password..." : "Save Password and Join Workspace"}
                </button>
              </form>
              <div class="auth-login-secondary-row">
                <button class="auth-login-link" type="button" data-action="invite-sign-out" ${isInvitePasswordSetupPending ? "disabled" : ""}>
                  Start over with a different account
                </button>
              </div>
            `
            : inviteOtpSentTo
              ? `
                <div class="auth-login-status is-success">
                  <div class="auth-login-status-icon"><i class="bi bi-envelope-check" aria-hidden="true"></i></div>
                  <div>
                    <p class="auth-login-status-title">Check your inbox</p>
                    <p>We sent a one-time code to <strong>${escapeHtml(inviteOtpSentTo)}</strong>. Enter it below to verify your invite email.</p>
                  </div>
                </div>
                <form id="inviteOtpVerifyForm" class="auth-login-form invite-accept-form">
                  <label class="auth-login-field" for="inviteOtpInput">
                    <span>Verification code</span>
                    <input
                      id="inviteOtpInput"
                      class="auth-login-input auth-login-code-input"
                      name="token"
                      type="text"
                      value="${escapeHtml(inviteOtpDraft)}"
                      placeholder="123456"
                      inputmode="numeric"
                      autocomplete="one-time-code"
                      data-invite-otp-input
                      required
                      ${isInviteOtpVerifyPending ? "disabled" : ""}
                    />
                  </label>
                  <button class="btn btn-light auth-login-magic" type="submit" ${isInviteOtpVerifyPending ? "disabled" : ""}>
                    ${isInviteOtpVerifyPending ? "Verifying..." : "Verify Code"}
                  </button>
                </form>
                <div class="auth-login-secondary-row">
                  <button class="auth-login-link" type="button" data-action="invite-resend-otp" ${isInviteOtpSendPending || isInviteOtpVerifyPending ? "disabled" : ""}>
                    ${isInviteOtpSendPending ? "Sending another code..." : "Resend code"}
                  </button>
                  <button class="auth-login-link" type="button" data-action="invite-cancel-otp" ${isInviteOtpSendPending || isInviteOtpVerifyPending ? "disabled" : ""}>
                    Back
                  </button>
                </div>
              `
          : isProcessing
            ? processingMarkup
            : `
              <div class="empty-state-actions invite-accept-actions">
                <button class="btn btn-accent" type="button" data-action="invite-google-sign-in">Continue with Google</button>
                <button class="btn btn-light" type="button" data-action="invite-send-otp" ${isInviteOtpSendPending ? "disabled" : ""}>
                  ${isInviteOtpSendPending ? "Sending code..." : "Continue with Email"}
                </button>
              </div>
            `
      }
    `;
  } else if (lookupError) {
    bodyMarkup = `
      <p>${escapeHtml(lookupError)}</p>
      <div class="empty-state-actions">
        <button class="btn btn-light" type="button" data-action="invite-sign-out">Back</button>
      </div>
    `;
  }

  return {
    title: "Accept Invite",
    subtitle: "Join workspace",
    showWaitingPanel: false,
    html: `
      <section class="view-block invite-accept-view">
        <div class="empty-state-card invite-accept-card">
          <div class="empty-state-icon"><i class="bi bi-person-check" aria-hidden="true"></i></div>
          <h3>${escapeHtml(name || email || "Workspace Invite")}</h3>
          ${bodyMarkup}
        </div>
      </section>
    `
  };
}

export function renderTeamMemberProfile(data, context) {
  const members = Array.isArray(data.teamMembers) ? data.teamMembers : [];
  const selectedId = String(context.selectedTeamMemberId || "").trim();
  const member = members.find((item) => item.id === selectedId) || members[0] || null;

  if (!member) {
    return {
      title: "Team Member Profile",
      subtitle: "No team members available",
      showWaitingPanel: false,
      html: `
        <section class="view-block settings-profile-view">
          <p class="task-meta">No team members found. Invite a member in Team Management first.</p>
          <div class="form-actions">
            <button type="button" class="btn btn-accent" data-route="team">Open Team</button>
          </div>
        </section>
      `
    };
  }

  const managerOptions = [
    { value: "", label: "No manager" },
    ...members.filter((item) => item.id !== member.id).map((item) => ({ value: item.name, label: item.name }))
  ];
  const scopeValue = normalizeScope(member.scope);
  const permissions = normalizePermissions(member);
  const isInvited = isTeamMemberPendingInvite(member.status);
  const statusToggleLabel = normalizeTeamMemberStatus(member.status) === "Inactive" ? "Reactivate" : "Deactivate";
  const roleOptions = getAssignableTeamRoles(member, data);
  const canManageTeam = canManageTeamMembersByRole(data.currentUser?.role);
  const ownerLocked = canManageTeam && !canManageOwnerTeamMember(member, data);
  const canEditMember = canManageTeam && !ownerLocked;
  const controlDisabledAttr = canEditMember ? "" : "disabled";
  const memberAvatarUrl = String(member.avatarUrl || "").trim();
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const validTabs = new Set(["overview", "leads", "deals", "tasks", "activity", "settings"]);
  const requestedTab = String(context.teamMemberProfileTab || "overview").trim().toLowerCase();
  const activeTab = validTabs.has(requestedTab) ? requestedTab : "overview";

  const assignedLeads = (Array.isArray(data.leads) ? data.leads : [])
    .filter(
      (lead) =>
        !lead?.archived &&
        String(lead?.status || "").trim() !== "Archived" &&
        teamMemberMatchesRecord(member, lead?.ownerId, lead?.owner)
    )
    .sort((left, right) => {
      const leftDue = String(left?.nextFollowUp || "9999-12-31");
      const rightDue = String(right?.nextFollowUp || "9999-12-31");
      return rightDue === leftDue
        ? String(right?.updatedAt || right?.createdAt || "").localeCompare(String(left?.updatedAt || left?.createdAt || ""))
        : leftDue.localeCompare(rightDue);
    });

  const openDeals = (Array.isArray(data.deals) ? data.deals : [])
    .filter((deal) => {
      if (deal?.archived || !teamMemberMatchesRecord(member, deal?.ownerId, deal?.owner)) {
        return false;
      }
      const stage = String(deal?.stage || "").trim().toLowerCase();
      return !["won", "lost", "closed won", "closed lost"].includes(stage);
    })
    .sort((left, right) => {
      const leftClose = String(left?.closeDate || "9999-12-31");
      const rightClose = String(right?.closeDate || "9999-12-31");
      return rightClose === leftClose
        ? String(right?.updatedAt || right?.createdAt || "").localeCompare(String(left?.updatedAt || left?.createdAt || ""))
        : leftClose.localeCompare(rightClose);
    });

  const assignedTasks = (Array.isArray(data.tasks) ? data.tasks : [])
    .filter((task) => teamMemberMatchesRecord(member, task?.assigneeId, task?.assignee))
    .sort((left, right) => {
      const leftDue = String(left?.dueDate || "9999-12-31");
      const rightDue = String(right?.dueDate || "9999-12-31");
      return rightDue === leftDue
        ? String(right?.updatedAt || right?.createdAt || "").localeCompare(String(left?.updatedAt || left?.createdAt || ""))
        : leftDue.localeCompare(rightDue);
    });

  const openTasks = assignedTasks.filter((task) => String(task?.status || "").trim() !== "Completed");
  const completedTaskCount = Math.max(0, assignedTasks.length - openTasks.length);
  const ownedAccounts = (Array.isArray(data.accounts) ? data.accounts : [])
    .filter((account) => !account?.archived && teamMemberMatchesRecord(member, account?.ownerId, account?.owner));
  const profileHeroSubtitle = [
    String(member.title || "").trim(),
    String(member.team || "").trim()
  ].filter(Boolean).join(" / ") || String(member.team || "").trim() || "Unassigned";
  const activityItems = collectTeamMemberActivity(member, assignedLeads, openDeals, assignedTasks);
  const managementNote = !canManageTeam
    ? "You can view this member profile, but only users with team-management access can edit settings."
    : ownerLocked
      ? "Only workspace owners can edit another owner account."
      : isInvited
        ? "Invite is still pending. Use the controls below to resend, copy, or cancel the invitation."
        : "Update this member's workspace details, access scope, and permissions.";
  const inviteActions = isInvited && canEditMember
    ? `
      <button type="button" class="btn btn-light" data-action="team-resend-invite" data-id="${escapeHtml(member.id)}">Resend Invite</button>
      <button type="button" class="btn btn-light" data-action="team-copy-invite-link" data-id="${escapeHtml(member.id)}">Copy Invite Link</button>
      <button type="button" class="btn btn-light" data-action="team-cancel-invite" data-id="${escapeHtml(member.id)}">Cancel Invite</button>
    `
    : "";
  const activeActions = !isInvited && canEditMember
    ? `
      ${normalizeTeamMemberStatus(member.status) === "Active" ? `<button type="button" class="btn btn-light" data-action="team-reset-access" data-id="${escapeHtml(member.id)}">Reset Access</button>` : ""}
      <button type="button" class="btn btn-light" data-action="${normalizeTeamMemberStatus(member.status) === "Inactive" ? "team-reactivate" : "team-deactivate"}" data-id="${escapeHtml(member.id)}">${statusToggleLabel}</button>
    `
    : "";
  const tabButton = (id, label, count = "") => {
    const isActive = activeTab === id;
    return `
      <button
        type="button"
        class="team-member-profile-tab ${isActive ? "is-active" : ""}"
        id="team-member-profile-tab-${escapeHtml(id)}"
        role="tab"
        data-action="team-member-profile-tab"
        data-id="${escapeHtml(id)}"
        data-team-member-view-tab="${escapeHtml(id)}"
        aria-selected="${isActive ? "true" : "false"}"
        aria-controls="team-member-profile-panel-${escapeHtml(id)}"
        tabindex="${isActive ? "0" : "-1"}"
      >
        <span>${escapeHtml(label)}</span>
        ${count === "" ? "" : `<span class="team-member-profile-tab-count">${escapeHtml(String(count))}</span>`}
      </button>
    `;
  };
  const sidebarStatsMarkup = `
    <div class="team-member-profile-sidebar-section team-member-profile-sidebar-section-stats">
      <div class="team-member-profile-stat-grid">
        <article class="team-member-profile-stat">
          <span>Leads</span>
          <strong>${escapeHtml(String(assignedLeads.length))}</strong>
        </article>
        <article class="team-member-profile-stat">
          <span>Deals</span>
          <strong>${escapeHtml(String(openDeals.length))}</strong>
        </article>
        <article class="team-member-profile-stat">
          <span>Tasks</span>
          <strong>${escapeHtml(String(openTasks.length))}</strong>
        </article>
      </div>
    </div>
  `;
  const sidebarFactsMarkup = `
    <div class="team-member-profile-sidebar-section team-member-profile-sidebar-section-details">
      <div class="team-member-profile-sidebar-list">
        <div class="team-member-profile-sidebar-list-row">
          <span>Email</span>
          <strong>${escapeHtml(member.email || "No email")}</strong>
        </div>
        <div class="team-member-profile-sidebar-list-row">
          <span>Manager</span>
          <strong>${escapeHtml(member.manager || "No manager")}</strong>
        </div>
        <div class="team-member-profile-sidebar-list-row">
          <span>Timezone</span>
          <strong>${escapeHtml(member.timezone || "Local")}</strong>
        </div>
        <div class="team-member-profile-sidebar-list-row">
          <span>Shift</span>
          <strong>${escapeHtml(member.shift || "09:00-18:00")}</strong>
        </div>
        <div class="team-member-profile-sidebar-list-row">
          <span>Last active</span>
          <strong>${escapeHtml(teamMemberLastActiveLabel(member))}</strong>
        </div>
      </div>
    </div>
  `;
  const sidebarTagsMarkup = `
    <div class="team-member-profile-sidebar-section team-member-profile-sidebar-section-tags">
      <div class="lead-profile-chip-row team-member-profile-sidebar-tags">
        <span class="lead-profile-icon-chip">${teamMemberInfoText("bi-shield-check", `Scope ${scopeValue.toUpperCase()}`, "lead-profile-icon-text")}</span>
        <span class="lead-profile-icon-chip">${teamMemberInfoText("bi-buildings", `${ownedAccounts.length} account${ownedAccounts.length === 1 ? "" : "s"}`, "lead-profile-icon-text")}</span>
        <span class="lead-profile-icon-chip">${teamMemberInfoText("bi-collection", member.queueEligible ? "Queue eligible" : "Direct assignment", "lead-profile-icon-text")}</span>
      </div>
    </div>
  `;
  const overviewPanelMarkup = `
    <section id="team-member-profile-panel-overview" class="lead-profile-panel team-member-profile-panel" data-team-member-view-panel="overview" role="tabpanel" aria-labelledby="team-member-profile-tab-overview">
      <section class="team-member-overview-main">
        <section class="team-member-panel-block">
          <header class="team-member-panel-head">
            <div>
              <p class="lead-profile-section-title">Assigned Leads</p>
              <h4>Current lead ownership</h4>
            </div>
            <button type="button" class="mini-btn mini-btn-primary" data-action="team-member-profile-tab" data-id="leads">View all</button>
          </header>
          <div class="lead-profile-list team-member-record-list">${buildTeamMemberLeadRows(assignedLeads, { limit: 4 })}</div>
        </section>

        <section class="team-member-panel-block">
          <header class="team-member-panel-head">
            <div>
              <p class="lead-profile-section-title">Open Deals</p>
              <h4>Pipeline this member owns</h4>
            </div>
            <button type="button" class="mini-btn mini-btn-primary" data-action="team-member-profile-tab" data-id="deals">View all</button>
          </header>
          <div class="lead-profile-list team-member-record-list">${buildTeamMemberDealRows(openDeals, { limit: 4 })}</div>
        </section>

        <section class="team-member-panel-block">
          <header class="team-member-panel-head">
            <div>
              <p class="lead-profile-section-title">Open Tasks</p>
              <h4>Current work assigned</h4>
            </div>
            <button type="button" class="mini-btn mini-btn-primary" data-action="team-member-profile-tab" data-id="tasks">View all</button>
          </header>
          <div class="lead-profile-list team-member-record-list">${buildTeamMemberTaskRows(openTasks, { limit: 5 })}</div>
        </section>

        <section class="team-member-panel-block">
          <header class="team-member-panel-head">
            <div>
              <p class="lead-profile-section-title">Recent Activity</p>
              <h4>Latest movement across owned records</h4>
            </div>
            <button type="button" class="mini-btn mini-btn-primary" data-action="team-member-profile-tab" data-id="activity">View all</button>
          </header>
          ${buildTeamMemberActivityRows(activityItems, { limit: 6 })}
        </section>
      </section>
    </section>
  `;
  const leadsPanelMarkup = `
    <section id="team-member-profile-panel-leads" class="lead-profile-panel team-member-profile-panel" data-team-member-view-panel="leads" role="tabpanel" aria-labelledby="team-member-profile-tab-leads">
      <section class="team-member-panel-block">
        <header class="team-member-panel-head">
          <div>
            <p class="lead-profile-section-title">Leads</p>
            <h4>All active leads assigned to ${escapeHtml(member.name)}</h4>
          </div>
          <span class="status-chip">${escapeHtml(String(assignedLeads.length))}</span>
        </header>
        <div class="lead-profile-list team-member-record-list team-member-record-list-wide">${buildTeamMemberLeadRows(assignedLeads, { limit: 0 })}</div>
      </section>
    </section>
  `;
  const dealsPanelMarkup = `
    <section id="team-member-profile-panel-deals" class="lead-profile-panel team-member-profile-panel" data-team-member-view-panel="deals" role="tabpanel" aria-labelledby="team-member-profile-tab-deals">
      <section class="team-member-panel-block">
        <header class="team-member-panel-head">
          <div>
            <p class="lead-profile-section-title">Deals</p>
            <h4>Open pipeline currently owned by ${escapeHtml(member.name)}</h4>
          </div>
          <span class="status-chip">${escapeHtml(String(openDeals.length))}</span>
        </header>
        <div class="lead-profile-list team-member-record-list team-member-record-list-wide">${buildTeamMemberDealRows(openDeals, { limit: 0 })}</div>
      </section>
    </section>
  `;
  const tasksPanelMarkup = `
    <section id="team-member-profile-panel-tasks" class="lead-profile-panel team-member-profile-panel" data-team-member-view-panel="tasks" role="tabpanel" aria-labelledby="team-member-profile-tab-tasks">
      <section class="team-member-panel-block">
        <header class="team-member-panel-head">
          <div>
            <p class="lead-profile-section-title">Tasks</p>
            <h4>Open tasks assigned to ${escapeHtml(member.name)}</h4>
          </div>
          <span class="status-chip">${escapeHtml(String(openTasks.length))}</span>
        </header>
        ${completedTaskCount ? `<p class="team-member-profile-note">${escapeHtml(`${completedTaskCount} completed task${completedTaskCount === 1 ? "" : "s"} hidden from this view.`)}</p>` : ""}
        <div class="lead-profile-list team-member-record-list team-member-record-list-wide">${buildTeamMemberTaskRows(openTasks, { limit: 0 })}</div>
      </section>
    </section>
  `;
  const activityPanelMarkup = `
    <section id="team-member-profile-panel-activity" class="lead-profile-panel team-member-profile-panel" data-team-member-view-panel="activity" role="tabpanel" aria-labelledby="team-member-profile-tab-activity">
      <section class="team-member-panel-block">
        <header class="team-member-panel-head">
          <div>
            <p class="lead-profile-section-title">Activity</p>
            <h4>Recent updates tied to this member</h4>
          </div>
        </header>
        ${buildTeamMemberActivityRows(activityItems, { limit: 12 })}
      </section>
    </section>
  `;
  const settingsPanelMarkup = `
    <section id="team-member-profile-panel-settings" class="lead-profile-panel team-member-profile-panel" data-team-member-view-panel="settings" role="tabpanel" aria-labelledby="team-member-profile-tab-settings">
      <form id="teamMemberProfileForm" class="lead-profile-surface lead-record-surface team-member-profile-form" data-member-id="${escapeHtml(member.id)}">
        <header class="team-member-profile-card-head">
          <div>
            <p class="lead-profile-section-title">Access &amp; permissions</p>
            <h4>Member access and assignment</h4>
          </div>
        </header>
        <p class="team-member-profile-note">${escapeHtml(managementNote)}</p>

        <section class="profile-block">
          <h4>Identity & Team</h4>
          <div class="profile-grid profile-grid-2">
            <label class="form-field"><span>Name</span><input type="text" name="name" value="${escapeHtml(member.name || "")}" required ${controlDisabledAttr} /></label>
            <label class="form-field"><span>Email</span><input type="email" name="email" value="${escapeHtml(member.email || "")}" required ${controlDisabledAttr} /></label>
            <label class="form-field"><span>Job Title</span><input type="text" name="title" value="${escapeHtml(member.title || "")}" placeholder="Sales Manager" ${controlDisabledAttr} /></label>
            <label class="form-field"><span>Department / Team</span><input type="text" name="team" value="${escapeHtml(member.team || "")}" required ${controlDisabledAttr} /></label>
            <label class="form-field"><span>Manager</span><select name="manager" ${controlDisabledAttr}>${managerOptions.map((item) => `<option value="${escapeHtml(item.value)}" ${String(member.manager || "") === item.value ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}</select></label>
            <label class="form-field"><span>Timezone</span><select name="timezone" ${controlDisabledAttr}>${ATTENDANCE_TIMEZONE_OPTIONS.map((item) => `<option value="${escapeHtml(item)}" ${String(member.timezone || "Local") === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}</select></label>
          </div>
        </section>

        <section class="profile-block">
          <h4>Access</h4>
          <div class="profile-grid profile-grid-2">
            <label class="form-field"><span>Status</span><select name="status" ${controlDisabledAttr}>${["Pending Invite", "Active", "Inactive"].map((item) => `<option value="${item}" ${normalizeTeamMemberStatus(member.status) === item ? "selected" : ""}>${item}</option>`).join("")}</select></label>
            <label class="form-field"><span>Role</span><select name="role" ${controlDisabledAttr}>${roleOptions.map((item) => `<option value="${item}" ${String(member.role || "") === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}</select></label>
            <label class="form-field"><span>Data Scope</span><select name="scope" ${controlDisabledAttr}>${PROFILE_SCOPE_OPTIONS.map((item) => `<option value="${item}" ${scopeValue === item ? "selected" : ""}>${item.toUpperCase()}</option>`).join("")}</select></label>
            <label class="form-field"><span>Shift</span><input type="text" name="shift" value="${escapeHtml(member.shift || "09:00-18:00")}" placeholder="09:00-18:00" ${controlDisabledAttr} /></label>
          </div>
          <div class="profile-toggle-row">
            <label class="profile-check"><input type="checkbox" name="queueEligible" ${member.queueEligible ? "checked" : ""} ${controlDisabledAttr} /> Queue eligible</label>
            <label class="profile-check"><input type="checkbox" name="defaultOwner" ${member.defaultOwner ? "checked" : ""} ${controlDisabledAttr} /> Default owner candidate</label>
          </div>
        </section>

        <section class="profile-block">
          <h4>Advanced Permissions</h4>
          <div class="permission-matrix-shell">
            <table class="permission-matrix">
              <thead>
                <tr><th>Module</th>${PROFILE_PERMISSION_ACTIONS.map((action) => `<th>${escapeHtml(action)}</th>`).join("")}</tr>
              </thead>
              <tbody>
                ${PROFILE_PERMISSION_MODULES.map((module) => {
                  const current = permissions?.[module.id] || {};
                  return `
                    <tr>
                      <td>${escapeHtml(module.label)}</td>
                      ${PROFILE_PERMISSION_ACTIONS.map((action) => `<td><input type="checkbox" name="perm__${escapeHtml(module.id)}__${escapeHtml(action)}" ${current[action] ? "checked" : ""} ${controlDisabledAttr} /></td>`).join("")}
                    </tr>
                  `;
                }).join("")}
              </tbody>
            </table>
          </div>
        </section>

        <div class="form-actions">
          ${inviteActions}
          ${activeActions}
          ${canEditMember ? `<button type="submit" class="btn btn-accent">Save Member</button>` : ""}
        </div>
      </form>
    </section>
  `;
  const activePanelMarkup =
    {
      overview: overviewPanelMarkup,
      leads: leadsPanelMarkup,
      deals: dealsPanelMarkup,
      tasks: tasksPanelMarkup,
      activity: activityPanelMarkup,
      settings: settingsPanelMarkup
    }[activeTab] || overviewPanelMarkup;

  return {
    title: "Team Member Profile",
    subtitle: "CRM-style member record and assignments",
    showWaitingPanel: false,
    html: `
      <section class="view-block settings-profile-view lead-profile-page-view team-member-profile-page">
        <div class="team-member-profile-shell">
          <aside class="team-member-profile-sidebar">
            <article class="team-member-profile-sidebar-card team-member-profile-sidebar-card-identity">
              <div class="team-member-profile-sidebar-hero">
                <div class="team-member-profile-sidebar-cover" aria-hidden="true"></div>
                <span class="team-member-profile-sidebar-avatar">
                  ${memberAvatarUrl ? `<img src="${escapeHtml(memberAvatarUrl)}" alt="${escapeHtml(member.name || "Team member")}" />` : escapeHtml(memberInitials(member.name))}
                </span>
                <div class="team-member-profile-sidebar-copy">
                  <h4>${escapeHtml(member.name)}</h4>
                  <p>${escapeHtml(profileHeroSubtitle)}</p>
                </div>
                <div class="lead-profile-chip-row team-member-profile-sidebar-badges">
                  ${teamMemberRoleBadge(member.role)}
                  ${teamMemberStatusBadge(member.status)}
                </div>
              </div>
              ${sidebarStatsMarkup}
              ${sidebarFactsMarkup}
              ${sidebarTagsMarkup}
            </article>
          </aside>

          <div class="team-member-profile-content">
            <section class="team-member-profile-toolbar">
              <div class="team-member-profile-toolbar-copy">
                <p class="lead-profile-section-title">Workspace Record</p>
                <h4>${escapeHtml(`${member.name}'s CRM record`)}</h4>
                <p>${escapeHtml(`Track ${member.name}'s leads, deals, tasks, and workspace activity in one place.`)}</p>
              </div>
              <div class="lead-profile-head-actions team-member-profile-actions">
                <button class="table-ops-columns-btn" type="button" data-route="team">
                  <i class="bi bi-people" aria-hidden="true"></i>
                  <span>Back To Team</span>
                </button>
                ${
                  assignedLeads.length
                    ? `<button class="btn btn-light" type="button" data-action="team-member-profile-tab" data-id="leads">View Leads</button>`
                    : ""
                }
                ${
                  canManageTeam
                    ? `<button class="btn btn-light" type="button" data-action="lead-ownership-manager" data-id="${escapeHtml(member.id)}">Manage Leads</button>`
                    : ""
                }
                ${
                  canManageTeam
                    ? `<button class="btn btn-light" type="button" data-action="team-member-profile-tab" data-id="settings">Manage access</button>`
                    : ""
                }
              </div>
            </section>

            <section class="team-member-profile-canvas">
              <nav class="team-member-profile-tabs" aria-label="Team member profile tabs" role="tablist">
                ${tabButton("overview", "Overview")}
                ${tabButton("leads", "Leads", assignedLeads.length)}
                ${tabButton("deals", "Deals", openDeals.length)}
                ${tabButton("tasks", "Tasks", openTasks.length)}
                ${tabButton("activity", "Activity", Math.min(activityItems.length, 99))}
                ${tabButton("settings", "Access & permissions")}
              </nav>
              ${activePanelMarkup}
            </section>
          </div>
        </div>
      </section>
    `
  };
}
