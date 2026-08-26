import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const violations = results.violations.filter(({ impact }) => impact === "serious" || impact === "critical");
  expect(violations, violations.map(({ id, help, nodes }) => `${id}: ${help} (${nodes.length})`).join("\n")).toEqual([]);
}

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(overflow.documentScrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

async function expectInsideViewport(page: Page, selector: string) {
  const bounds = await page.locator(selector).boundingBox();
  const viewport = page.viewportSize();
  expect(bounds).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(-1);
  expect(bounds!.y).toBeGreaterThanOrEqual(-1);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.height + 1);
}

async function expectReadableText(page: Page, rootSelector: string) {
  const undersized = await page.locator(`${rootSelector} small, ${rootSelector} label, ${rootSelector} p, ${rootSelector} button, ${rootSelector} strong, ${rootSelector} em, ${rootSelector} time`).evaluateAll((elements) => elements.flatMap((element) => {
    const style = getComputedStyle(element);
    const size = Number.parseFloat(style.fontSize);
    const text = element.textContent?.trim() ?? "";
    return text && style.display !== "none" && style.visibility !== "hidden" && size < 10
      ? [`${element.tagName.toLowerCase()}.${element.className}: ${size}px (${text.slice(0, 40)})`]
      : [];
  }));
  expect(undersized).toEqual([]);
}

async function openHydratedApplication(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome to the table" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Dan.*Test as this person/ })).toBeEnabled();
}

async function openCampaignAs(page: Page, person: "Dan" | "Kevin") {
  const campaigns = page.waitForResponse((response) =>
    response.url().endsWith("/api/campaigns") && response.request().method() === "GET");
  await page.getByRole("button", { name: new RegExp(`${person}.*Test as this person`) }).click();
  await campaigns;
  await expect(page.getByRole("heading", { name: "Campaigns" })).toBeVisible();
  await page.getByRole("button", { name: /Open campaign/ }).click();
  await expect(page.getByRole("heading", { name: "Force of Nature" })).toBeVisible();
}

async function enterFirstEncounterAsDm(page: Page) {
  await openHydratedApplication(page);
  await openCampaignAs(page, "Kevin");
  await page.getByRole("button", { name: "Battle map" }).first().click();
  await expect(page.getByRole("application", { name: /battle grid with .* visible tokens/i })).toBeVisible();
}

async function setupFirstEncounterAsDm(page: Page) {
  await openHydratedApplication(page);
  await openCampaignAs(page, "Kevin");
  await page.getByRole("button", { name: "Set up" }).first().click();
  await expect(page.getByText("Encounter Setup · Draft", { exact: true })).toBeVisible();
  await expect(page.getByText("Briefing & handouts", { exact: true })).toBeVisible();
}

async function visibleTokenCount(page: Page) {
  const label = await page.getByRole("application", { name: /battle grid with .* visible tokens/i }).getAttribute("aria-label");
  const count = label?.match(/with (\d+) visible tokens/)?.[1];
  if (!count) throw new Error(`Unable to read visible-token count from: ${label}`);
  return Number(count);
}

async function durableDrawingCount(page: Page) {
  const label = await page.locator("button[data-tooltip='Clear durable drawings']").getAttribute("aria-label");
  if (label === "No drawings to clear") return 0;
  const count = label?.match(/^Clear (\d+) drawings?$/)?.[1];
  if (!count) throw new Error(`Unable to read durable drawing count from: ${label}`);
  return Number(count);
}

async function tapExposedMap(page: Page, drawerSelector: string) {
  const canvasLocator = page.getByRole("application", { name: /battle grid with .* visible tokens/i });
  const canvas = await canvasLocator.boundingBox();
  const drawer = await page.locator(drawerSelector).boundingBox();
  expect(canvas).not.toBeNull();
  expect(drawer).not.toBeNull();
  const x = canvas!.x + canvas!.width / 2;
  const y = Math.min(canvas!.y + canvas!.height - 8, drawer!.y - 12);
  expect(y).toBeGreaterThan(canvas!.y + 8);
  await canvasLocator.click({ position: { x: x - canvas!.x, y: y - canvas!.y } });
}

test("development identity login is keyboard-accessible and production-branded", async ({ page }) => {
  await openHydratedApplication(page);

  await expect(page).toHaveTitle("D&D Battle Map");
  await expect(page.getByRole("heading", { name: "Welcome to the table" })).toBeVisible();
  const dan = page.getByRole("button", { name: /Dan.*Test as this person/ });
  await expect(dan).toBeFocused();
  await expectNoSeriousAccessibilityViolations(page);

  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Welcome back, Dan." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Campaigns" })).toBeVisible();
  await expect(page.getByText("Dar'eleth · Paladin")).toBeVisible();
  await page.getByRole("button", { name: /Open campaign/ }).click();
  await expect(page.getByRole("heading", { name: "Encounters" })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});

test("public privacy and terms pages explain the Google sign-in relationship", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page).toHaveTitle(/Privacy Policy/);
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
  await expect(page.getByText(/do not receive your Google password/i)).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);

  await page.getByRole("link", { name: "Terms", exact: true }).click();
  await expect(page).toHaveTitle(/Terms of Service/);
  await expect(page.getByRole("heading", { name: "Terms of Service" })).toBeVisible();
  await expect(page.getByText(/independent fan-made tool/i)).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});

test("mobile login and campaign home do not overflow the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openHydratedApplication(page);

  await expectNoPageOverflow(page);
  await openCampaignAs(page, "Kevin");
  await expectNoPageOverflow(page);
  await expectNoSeriousAccessibilityViolations(page);
});

test("mobile presentation mode keeps an obvious exit action", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await enterFirstEncounterAsDm(page);

  await page.getByRole("button", { name: "Presentation mode" }).click();
  const exit = page.getByRole("button", { name: "Exit presentation" });
  await expect(exit).toBeVisible();
  const box = await exit.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await expectNoPageOverflow(page);

  await exit.click();
  await expect(exit).toBeHidden();
  await expect(page.getByLabel("Map tools and encounter status")).toBeVisible();
});

test("the DM can enter an encounter and reach an accessible battle-map shell", async ({ page }) => {
  await enterFirstEncounterAsDm(page);
  await expect(page.getByLabel("Map tools and encounter status")).toBeVisible();
  await page.locator("summary[aria-label='UI Settings']").click();
  await expect(page.getByLabel("Colored token centers")).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});

test("campaign home refreshes encounter status after returning from the battle map", async ({ page }) => {
  await enterFirstEncounterAsDm(page);

  const refreshedCampaigns = page.waitForResponse((response) =>
    response.url().endsWith("/api/campaigns") && response.request().method() === "GET");
  await page.getByRole("button", { name: "Back to campaign home" }).click();
  const response = await refreshedCampaigns;
  const campaignAccess = await response.json() as { items: Array<{ encounters: Array<{ name: string; status: "setup" | "active" | "paused" }> }> };
  const refreshedEncounter = campaignAccess.items[0]?.encounters[0];
  expect(refreshedEncounter).toBeTruthy();

  const statusLabel = refreshedEncounter!.status === "active"
    ? "In combat"
    : refreshedEncounter!.status === "paused" ? "Paused" : "Ready";
  const encounterCard = page.locator(".scenario-card").filter({ has: page.getByRole("heading", { name: refreshedEncounter!.name, exact: true }) });
  await expect(encounterCard.getByText(statusLabel, { exact: true })).toBeVisible();
});

test("the main map and encounter setup support a complete no-pointer spatial flow", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await enterFirstEncounterAsDm(page);
  const map = page.getByRole("application", { name: /battle grid with .* visible tokens/i });
  await map.focus();
  await expect(map).toBeFocused();

  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("PageUp");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Move confirmed/).first()).toBeVisible();

  await map.focus();
  await page.keyboard.press("l");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Tactical line shared.").first()).toBeVisible();

  await page.getByRole("button", { name: "Back to campaign home" }).click();
  const setupLauncher = page.getByRole("button", { name: "Set up" }).first();
  await setupLauncher.focus();
  await page.keyboard.press("Enter");
  const labelTool = page.getByRole("button", { name: "Add map label" });
  await labelTool.focus();
  await page.keyboard.press("Enter");
  const workshop = page.getByRole("application", { name: /editable map draft/i });
  await workshop.focus();
  await page.keyboard.press("Enter");
  const labelText = page.getByLabel("Label text");
  await expect(labelText).toBeFocused();
  await page.keyboard.type("Keyboard browser marker");
  await page.keyboard.press("Enter");
  await page.getByText("Map details").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /Keyboard browser marker.*everyone/i })).toBeVisible();
  await expectReadableText(page, ".workshop-shell");
  await expectNoSeriousAccessibilityViolations(page);

  await workshop.focus();
  await page.keyboard.press("Delete");
  await expect(page.getByRole("button", { name: /Keyboard browser marker.*everyone/i })).toBeHidden();

  const workshopBounds = await workshop.boundingBox();
  expect(workshopBounds).not.toBeNull();
  await workshop.click({ position: { x: workshopBounds!.width * 0.62, y: workshopBounds!.height * 0.48 } });
  await expect(labelText).toBeFocused();
  await page.keyboard.type("Pointer browser marker");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /Pointer browser marker.*everyone/i })).toBeVisible();
  await workshop.click({ position: { x: workshopBounds!.width * 0.62, y: workshopBounds!.height * 0.48 } });
  await expect(page.getByRole("form", { name: "Edit map label" })).toBeVisible();
  await expect(labelText).toHaveValue("Pointer browser marker");
  await labelText.fill("Revised browser marker");
  await page.getByRole("group", { name: "Label visibility" }).getByRole("button", { name: "DM only" }).click();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /Revised browser marker.*dm/i })).toBeVisible();
  await workshop.focus();
  await page.keyboard.press("Delete");
  const returnButton = page.getByRole("button", { name: "Return to encounters" });
  await returnButton.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Discard and return" }).focus();
  await page.keyboard.press("Enter");
  expect(pageErrors).toEqual([]);
});

test("blocking dialogs contain focus, inert the map, close on Escape, and restore the launcher", async ({ page }) => {
  await enterFirstEncounterAsDm(page);
  if (await durableDrawingCount(page) === 0) {
    const map = page.getByRole("application", { name: /battle grid with .* visible tokens/i });
    await map.focus();
    await page.keyboard.press("l");
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect.poll(() => durableDrawingCount(page)).toBe(1);
  }
  const drawingCount = await durableDrawingCount(page);
  const launcher = page.locator("button[data-tooltip='Clear durable drawings']");
  await launcher.click();
  const dialog = page.getByRole("dialog", { name: `Clear ${drawingCount} ${drawingCount === 1 ? "drawing" : "drawings"}?` });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep drawings" })).toBeFocused();
  expect(await page.locator(".workspace").evaluate((element) => (element as HTMLElement).inert)).toBe(true);
  await expectNoSeriousAccessibilityViolations(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(launcher).toBeFocused();
});

test("dirty encounter-setup exits are explicit and preserve the draft when cancelled", async ({ page }) => {
  await setupFirstEncounterAsDm(page);
  const visibilityMode = page.getByLabel("Visibility mode");
  await visibilityMode.selectOption("dynamic");
  await expect(page.getByText("Unsaved draft", { exact: true })).toBeVisible();

  const returnButton = page.getByRole("button", { name: "Return to encounters" });
  await returnButton.click();
  const guard = page.getByRole("dialog", { name: "Return to encounters with unsaved changes?" });
  await expect(guard).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep editing" })).toBeFocused();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(returnButton).toBeFocused();
  await expect(visibilityMode).toHaveValue("dynamic");

  await returnButton.click();
  await page.getByRole("button", { name: "Discard and return" }).click();
  await expect(page.getByRole("heading", { name: "Encounters" })).toBeVisible();
});

test("clear drawings confirms, supports undo and redo, and preserves unrelated map state", async ({ page }) => {
  await enterFirstEncounterAsDm(page);
  const originalCount = await durableDrawingCount(page);
  const map = page.getByRole("application", { name: /battle grid with .* visible tokens/i });
  const bounds = await map.boundingBox();
  expect(bounds).not.toBeNull();
  const start = { x: bounds!.x + bounds!.width * 0.08, y: bounds!.y + bounds!.height * 0.12 };
  const end = { x: bounds!.x + bounds!.width * 0.2, y: bounds!.y + bounds!.height * 0.12 };

  await page.getByRole("button", { name: "Draw line" }).click();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 3 });
  await page.mouse.up();
  await expect.poll(() => durableDrawingCount(page)).toBe(originalCount + 1);

  const clear = page.locator("button[data-tooltip='Clear durable drawings']");
  await clear.click();
  await expect(page.getByRole("dialog", { name: `Clear ${originalCount + 1} ${originalCount === 0 ? "drawing" : "drawings"}?` })).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep drawings" })).toBeFocused();
  await page.getByRole("button", { name: "Keep drawings" }).click();
  await expect.poll(() => durableDrawingCount(page)).toBe(originalCount + 1);

  await clear.click();
  await page.getByRole("button", { name: "Clear drawings" }).click();
  await expect.poll(() => durableDrawingCount(page)).toBe(0);
  await page.getByRole("button", { name: "Undo last action" }).click();
  await expect.poll(() => durableDrawingCount(page)).toBe(originalCount + 1);
  await page.getByRole("button", { name: "Redo last action" }).click();
  await expect.poll(() => durableDrawingCount(page)).toBe(0);
  await page.getByRole("button", { name: "Undo last action" }).click();
  await expect.poll(() => durableDrawingCount(page)).toBe(originalCount + 1);

  await page.getByRole("button", { name: "Erase line" }).click();
  await map.click({ position: { x: (start.x + end.x) / 2 - bounds!.x, y: start.y - bounds!.y } });
  await expect.poll(() => durableDrawingCount(page)).toBe(originalCount);
});

test.describe("mobile playability", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("settings and toolbar remain bounded at every supported narrow width", async ({ page }) => {
    await enterFirstEncounterAsDm(page);
    await page.locator("summary[aria-label='UI Settings']").click();

    for (const width of [320, 375, 560, 768]) {
      await page.setViewportSize({ width, height: width === 768 ? 1024 : 667 });
      await expectInsideViewport(page, ".ui-settings-panel");
      await expectNoPageOverflow(page);
      const targets = await page.locator(".command-bar button:visible, .command-bar summary:visible").evaluateAll((elements) => elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return { label: element.getAttribute("aria-label"), width: bounds.width, height: bounds.height };
      }));
      expect(targets.length).toBeGreaterThan(8);
      expect(targets.filter(({ width: targetWidth, height }) => targetWidth < 43.5 || height < 43.5)).toEqual([]);
    }

    await expectReadableText(page, ".ui-settings-panel");
    await expectNoSeriousAccessibilityViolations(page);
    await page.getByRole("button", { name: "Done" }).click();
    await page.setViewportSize({ width: 320, height: 667 });
    await page.getByRole("button", { name: "Move tokens" }).focus();
    await expectNoPageOverflow(page);
  });

  test("chat is a usable dynamic-viewport bottom sheet", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 667 });
    await enterFirstEncounterAsDm(page);
    await page.getByRole("button", { name: "Chat" }).click();
    await expectInsideViewport(page, ".chat-panel");
    const history = await page.locator(".chat-messages").boundingBox();
    expect(history?.height).toBeGreaterThanOrEqual(128);

    const composer = page.getByLabel("Chat message");
    const runLabel = `${testInfo.project.name}-${Date.now()}`;
    const firstMessage = `Mobile message one ${runLabel}`;
    const secondMessage = `Mobile message two ${runLabel}`;
    await composer.fill(firstMessage);
    await composer.press("Enter");
    await expect(page.getByText(firstMessage, { exact: true })).toBeVisible();
    await composer.fill(secondMessage);
    await composer.press("Enter");
    await expect(page.getByText(secondMessage, { exact: true })).toBeVisible();
    await composer.fill("A long mobile draft ".repeat(20));
    await page.getByRole("button", { name: "Attach image" }).click();

    await expectInsideViewport(page, ".chat-panel");
    expect((await page.locator(".chat-messages").boundingBox())?.height).toBeGreaterThanOrEqual(128);
    await expectReadableText(page, ".chat-panel");
    await expectNoPageOverflow(page);
    await expectNoSeriousAccessibilityViolations(page);
  });

  test("creature and spell drawers reveal the map for placement and clean up their test entities", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await enterFirstEncounterAsDm(page);
    const originalCount = await visibleTokenCount(page);

    await page.getByRole("button", { name: "Creature palette" }).click();
    const creature = page.locator(".creature-tile").first();
    await expect(creature).toBeVisible();
    await creature.click();
    await expect(page.locator(".creature-palette")).toHaveClass(/is-placement-armed/);
    expect((await page.locator(".creature-palette").boundingBox())?.height).toBeLessThanOrEqual(267);
    await expectReadableText(page, ".creature-palette");

    try {
      await tapExposedMap(page, ".creature-palette");
      await expect.poll(() => visibleTokenCount(page)).toBe(originalCount + 1);
      await expect(page.locator(".map-message")).toContainText("placed at");
    } finally {
      await page.getByRole("button", { name: "Close creature palette" }).click();
      const deleteButton = page.locator(".token-detail").getByRole("button", { name: "Delete" });
      if (await visibleTokenCount(page) > originalCount) {
        await expect(deleteButton).toBeVisible();
        await deleteButton.click();
        await page.getByRole("button", { name: "Confirm delete" }).click();
        await expect.poll(() => visibleTokenCount(page)).toBe(originalCount);
        await expect(page.locator(".map-message")).toContainText("Token removed");
      }
    }

    await page.getByRole("button", { name: "Spell effects" }).click();
    const spell = page.locator(".spell-tile").first();
    await expect(spell).toBeVisible();
    await spell.click();
    await expect(page.locator(".spell-palette")).toHaveClass(/is-placement-armed/);
    expect((await page.locator(".spell-palette").boundingBox())?.height).toBeLessThanOrEqual(267);
    await expectReadableText(page, ".spell-palette");

    try {
      await tapExposedMap(page, ".spell-palette");
      await expect(page.locator(".spell-palette")).not.toHaveClass(/is-placement-armed/);
      await expect.poll(() => visibleTokenCount(page)).toBe(originalCount + 1);
      await expect(page.locator(".map-message")).toContainText("manifested");
    } finally {
      await page.getByRole("button", { name: "Close spell effects" }).click();
      const dismiss = page.locator(".dismiss-spell-button");
      if (await visibleTokenCount(page) > originalCount) {
        await expect(dismiss).toBeVisible();
        await dismiss.click();
        await expect.poll(() => visibleTokenCount(page)).toBe(originalCount);
        await expect(page.locator(".map-message")).toContainText("dismissed");
      }
    }

    await expectNoPageOverflow(page);
    await expectNoSeriousAccessibilityViolations(page);
  });
});
