import { expect, test } from "@playwright/test";

test("Messenger prioritizes the inbox, conversation, and progressive composer", async ({ page }) => {
  await page.goto("/#/login", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Open local QA workspace" }).click();
  await page.waitForURL(/#\/dashboard$/);

  await page.goto("/#/comms-messenger");
  const messenger = page.locator(".messenger-view");
  await expect(messenger).toBeVisible();
  await expect(page.locator("#viewContent")).toHaveClass(/is-messenger-view/);
  await expect(page.locator("#viewContent")).toHaveCSS("padding-top", "0px");
  await expect(messenger.locator(".comms-rail")).toHaveCSS("border-radius", "0px");
  await expect(messenger.getByRole("heading", { name: "Messages" })).toBeVisible();
  await expect(messenger.locator("#commsSearch")).toHaveAttribute("placeholder", "Search messages");
  await expect(messenger.locator(".messenger-send-btn")).toHaveCSS("background-color", "rgb(55, 53, 47)");
  await expect(messenger.locator(".comms-composer")).toHaveCSS("padding-bottom", "22px");
  await expect(messenger.locator(".messenger-compose-dock")).not.toHaveCSS("box-shadow", "none");
  await expect(messenger.locator(".messenger-compose-dock")).toHaveCSS("border-top-width", "0px");
  await expect(messenger.locator("#commComposerText")).toHaveCSS("border-top-width", "0px");
  await expect(messenger.locator(".messenger-compose-dropdown")).not.toBeVisible();

  await messenger.getByRole("button", { name: "Open details" }).click();
  const detailsPane = messenger.locator(".messenger-info-pane");
  await expect(detailsPane).toHaveCSS("position", "absolute");
  await detailsPane.evaluate((element) => {
    element.scrollTop = Math.min(180, element.scrollHeight - element.clientHeight);
  });
  const savedDetailsScroll = await detailsPane.evaluate((element) => element.scrollTop);
  await messenger.getByRole("button", { name: "Open conversation General" }).click();
  await expect.poll(() => detailsPane.evaluate((element) => element.scrollTop)).toBe(savedDetailsScroll);

  await messenger.getByRole("button", { name: /Theme Default/ }).click();
  await expect(page.getByRole("heading", { name: "Customize chat theme" })).toBeVisible();
  await page.getByRole("button", { name: /Warm Muted clay accent/ }).click();
  await page.getByRole("button", { name: "Save theme" }).click();
  await expect(messenger).toHaveClass(/messenger-theme-soft/);
  await expect(messenger.locator(".message-row.is-self .message-bubble")).toHaveCSS(
    "background-color",
    "rgb(118, 92, 77)"
  );

  await messenger.getByRole("button", { name: "Open conversation Sales War Room" }).click();
  await messenger.getByRole("button", { name: /Nickname No nicknames set/ }).click();
  await page.getByRole("button", { name: "Edit nickname for Ken Li" }).click();
  await page.locator("input[name='nicknameValue']").fill("Kenny");
  await page.getByRole("button", { name: "Save nickname" }).click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(messenger.locator(".message-meta strong").filter({ hasText: "Kenny" })).toBeVisible();

  await messenger.getByRole("button", { name: /Group settings Rename/ }).click();
  const groupDialog = page.getByRole("dialog");
  await expect(groupDialog.getByRole("heading", { name: "Group settings" })).toBeVisible();
  await expect(groupDialog.getByRole("searchbox", { name: "Search active members" })).toBeVisible();
  await expect(groupDialog.getByText("4 selected")).toBeVisible();
  await expect(groupDialog.getByRole("button", { name: "Save changes" })).toBeDisabled();

  const kenOption = groupDialog.locator(".messenger-member-option").filter({ hasText: "Ken Li" });
  await kenOption.locator("input[type='checkbox']").uncheck();
  await expect(groupDialog.getByText("3 selected")).toBeVisible();
  await groupDialog.getByRole("button", { name: "Save changes" }).click();
  await expect(groupDialog.getByRole("heading", { name: "Remove 1 member?" })).toBeVisible();
  await expect(groupDialog.locator("[data-group-editor-view]")).not.toBeVisible();
  await expect(groupDialog.locator(".messenger-group-removal-list")).toContainText("Ken Li");
  await groupDialog.getByRole("button", { name: "Back" }).click();
  await expect(kenOption.locator("input[type='checkbox']")).not.toBeChecked();

  await groupDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(groupDialog.getByRole("heading", { name: "Discard your changes?" })).toBeVisible();
  await expect(groupDialog.locator("[data-group-editor-view]")).not.toBeVisible();
  await groupDialog.getByRole("button", { name: "Discard changes" }).click();
  await expect(groupDialog).not.toBeVisible();

  await messenger.getByRole("button", { name: "Close conversation details" }).click();
  await expect(messenger.locator(".messenger-info-pane")).toHaveCount(0);

  await messenger.getByRole("button", { name: "More message tools" }).click();
  await expect(messenger.getByRole("button", { name: "Attach file" })).toBeVisible();
  await expect(messenger.getByRole("button", { name: "Quick reply" })).toBeVisible();

  await messenger.locator(".messenger-create-toggle").click();
  await messenger.getByRole("button", { name: "Group chat" }).click();
  await expect(page.getByRole("heading", { name: "New Group Chat" })).toBeVisible();
  await expect(page.locator(".messenger-member-options")).toBeVisible();
  await expect(page.locator("input[name='groupChatMember']")).not.toHaveCount(0);
  await expect(page.locator(".new-group-chat-note")).toHaveCount(0);
});

test("Messenger loading state stays quiet and mirrors the final structure", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.setContent(`
    <link rel="stylesheet" href="/styles/app.css">
    <section class="messenger-view">
      <div class="messenger-skeleton-message is-self">
        <span class="messenger-skeleton-message-copy">
          <span class="messenger-skeleton-shape is-message-line"></span>
        </span>
      </div>
      <div class="comms-composer messenger-composer-skeleton">
        <section class="messenger-surface">
          <div class="messenger-compose-dock messenger-skeleton-compose-dock">
            <div class="messenger-skeleton-tools"><span class="messenger-skeleton-shape is-tool"></span></div>
            <span class="messenger-skeleton-shape is-composer-line"></span>
            <span class="messenger-skeleton-shape is-send"></span>
          </div>
        </section>
      </div>
      <aside class="messenger-info-pane messenger-info-skeleton"></aside>
    </section>
  `);

  await expect(page.locator(".messenger-skeleton-message-copy")).toHaveCSS("background-color", "rgb(237, 237, 235)");
  await expect(page.locator(".messenger-skeleton-compose-dock")).toHaveCSS("min-height", "44px");
  await expect(page.locator(".messenger-skeleton-compose-dock")).not.toHaveCSS("box-shadow", "none");
  await expect(page.locator(".messenger-skeleton-compose-dock")).toHaveCSS("border-top-width", "0px");
  await expect(page.locator(".messenger-info-skeleton")).toBeVisible();
});
