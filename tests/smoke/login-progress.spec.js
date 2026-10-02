import { expect, test } from "@playwright/test";

async function renderPendingLogin(page, provider) {
  await page.goto("/#/login", { waitUntil: "domcontentloaded" });
  return page.evaluate(async (nextProvider) => {
    const { renderLoginView } = await import("/src/views/settings.js");
    return renderLoginView(
      { workspace: { name: "Joynosync" } },
      {
        signedInUser: { email: "agent@example.com", provider: nextProvider },
        authAccessState: "loading",
        authActionPending: "",
        loginViewMode: "signin",
        loginEmailDraft: "agent@example.com"
      }
    ).html;
  }, provider);
}

test("initial session check uses a quiet bootstrap state", async ({ page }) => {
  await page.goto("/#/login", { waitUntil: "domcontentloaded" });
  const html = await page.evaluate(async () => {
    const { renderLoginView } = await import("/src/views/settings.js");
    return renderLoginView(
      { workspace: { name: "Joynosync", appLabel: "Joynosync", logoUrl: "" } },
      {
        authBootstrapPending: true,
        signedInUser: null
      }
    ).html;
  });

  expect(html).toContain('class="auth-login-view is-bootstrapping"');
  expect(html).toContain('class="auth-login-bootstrap"');
  expect(html).toContain("Opening your workspace");
  expect(html).not.toContain("Checking your session");
  expect(html).not.toContain('class="auth-login-status');
});

test("Google verification keeps the login form and updates its button", async ({ page }) => {
  const html = await renderPendingLogin(page, "google");

  expect(html).toContain("Signing in with Google…");
  expect(html).toContain("Sign in to Joynosync");
  expect(html).toContain("Have a workspace invitation?");
  expect(html).not.toContain("login-showcase");
  expect(html).not.toContain("Checking workspace access");
  expect(html).toMatch(/data-action="auth-sign-in" disabled/);
});

test("email verification keeps the login form and updates its button", async ({ page }) => {
  const html = await renderPendingLogin(page, "email");

  expect(html).toContain("<span>Signing in…</span>");
  expect(html).toContain('value="agent@example.com"');
  expect(html).not.toContain("Checking workspace access");
  expect(html).toContain('id="loginPasswordForm"');
});
