import { expect, test } from "@playwright/test";

test("local Leads table keeps stable rows while moving next and previous", async ({ page }) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("joyno_local_qa_session_v1", "active");
  });
  await page.goto("/#/leads", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    const { seedData } = await import("/src/data/seed.js");
    const data = structuredClone(seedData);
    data.leads = Array.from({ length: 60 }, (_, index) => ({
      id: `lead_pagination_${String(index + 1).padStart(3, "0")}`,
      name: `Pagination Lead ${String(index + 1).padStart(3, "0")}`,
      company: `Company ${String(index + 1).padStart(3, "0")}`,
      source: "Pagination QA",
      status: "New",
      owner: "",
      nextFollowUp: ""
    }));
    window.localStorage.setItem("joyno_local_qa_data_v1", JSON.stringify(data));
  });
  await page.reload({ waitUntil: "domcontentloaded" });

  const rows = page.locator("tr.lead-row");
  const previous = page.getByRole("button", { name: "Previous page" });
  const next = page.getByRole("button", { name: "Next page" });

  await expect(rows).toHaveCount(25);
  await expect(rows.first()).toContainText("Pagination Lead 001");
  await expect(previous).toBeDisabled();

  await next.click();
  await expect(rows).toHaveCount(25);
  await expect(rows.first()).toContainText("Pagination Lead 026");
  await expect(previous).toBeEnabled();

  await previous.click();
  await expect(rows.first()).toContainText("Pagination Lead 001");
  await expect(previous).toBeDisabled();
});
