import { expect, test } from "@playwright/test";

test("agent Leads prioritizes the personal call queue without admin controls", async ({ page }) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("joyno_local_qa_session_v1", "active");
  });
  await page.goto("/#/leads", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    const { seedData } = await import("/src/data/seed.js");
    const data = structuredClone(seedData);
    const member = data.teamMembers.find((item) => item.name === "Ken Li");
    data.currentUser = {
      ...data.currentUser,
      id: member.id,
      name: member.name,
      email: member.email,
      role: member.role,
      title: member.title,
      availability: "Online"
    };
    window.localStorage.setItem("joyno_local_qa_data_v1", JSON.stringify(data));
  });
  await page.reload({ waitUntil: "domcontentloaded" });

  const agentView = page.locator(".crm-leads-list.is-agent-view");
  await expect(agentView).toBeVisible();
  await expect(page.locator(".sidebar")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator(".topbar")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator(".view-content")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(agentView.getByRole("heading", { name: "My Leads" })).toBeVisible();
  await expect(page.locator("#globalSearch")).toHaveAttribute(
    "placeholder",
    "Search my leads by name, email, phone, interest..."
  );
  await expect(agentView.getByRole("button", { name: "Start next call" })).toBeVisible();
  await expect(agentView.getByRole("button", { name: "Add Lead" })).toBeVisible();
  await expect(agentView.locator(".lead-agent-viewbar")).toBeVisible();
  await expect(agentView.locator(".lead-agent-viewbar")).toHaveCSS("border-left-width", "0px");
  await expect(agentView.locator(".data-table-shell")).toHaveCSS("border-left-width", "0px");
  await expect(agentView.locator('.lead-agent-view-tab[data-id="queue"]')).toHaveCSS("color", "rgb(32, 34, 38)");
  await expect(agentView.locator("th.crm-col-progress")).toContainText("Progress");
  await expect(agentView.locator("th.crm-col-owner")).toHaveCount(0);
  await expect(agentView.locator("th.crm-col-next-followup")).toContainText("Next Action");
  await expect(agentView.locator(".lead-agent-workflow-hint")).toContainText("Complete the wrap-up");
  await expect(agentView.locator(".lead-agent-kpi")).toHaveCount(0);
  await expect(agentView.locator(".lead-agent-count-skeleton")).toHaveCount(0);
  await expect(agentView).not.toHaveAttribute("aria-busy", "true");

  const contactedView = agentView.locator('.lead-agent-view-tab[data-id="contacted"]');
  await contactedView.click();
  await expect(contactedView).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});
