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
  const encounterList = page.waitForResponse((response) =>
    response.url().endsWith("/api/encounters") && response.request().method() === "GET");
  await page.goto("/");
  await encounterList;
}

async function enterFirstScenarioAsDm(page: Page) {
  await openHydratedApplication(page);
  await page.getByRole("button", { name: /Kevin.*Dungeon Master/ }).click();
  await expect(page.getByRole("heading", { name: "Welcome back, Kevin." })).toBeVisible();
  await page.getByRole("button", { name: "Open scenario" }).first().click();
  await expect(page.getByRole("img", { name: /battle grid with .* visible tokens/i })).toBeVisible();
}

async function visibleTokenCount(page: Page) {
  const label = await page.getByRole("img", { name: /battle grid with .* visible tokens/i }).getAttribute("aria-label");
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
  const canvasLocator = page.getByRole("img", { name: /battle grid with .* visible tokens/i });
  const canvas = await canvasLocator.boundingBox();
  const drawer = await page.locator(drawerSelector).boundingBox();
  expect(canvas).not.toBeNull();
  expect(drawer).not.toBeNull();
  const x = canvas!.x + canvas!.width / 2;
  const y = Math.min(canvas!.y + canvas!.height - 8, drawer!.y - 12);
  expect(y).toBeGreaterThan(canvas!.y + 8);
  await canvasLocator.click({ position: { x: x - canvas!.x, y: y - canvas!.y } });
}

test("fixed-identity login is keyboard-accessible and production-branded", async ({ page }) => {
  await openHydratedApplication(page);

  await expect(page).toHaveTitle("D&D Battle Map");
  await expect(page.getByRole("heading", { name: "Choose your seat" })).toBeVisible();
  const dan = page.getByRole("button", { name: /Dan.*Dar'eleth.*Paladin/ });
  await expect(dan).toBeFocused();
  await expectNoSeriousAccessibilityViolations(page);

  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Welcome back, Dan." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Scenarios" })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});

test("mobile login and campaign home do not overflow the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openHydratedApplication(page);

  await expectNoPageOverflow(page);
  await page.getByRole("button", { name: /Kevin.*Dungeon Master/ }).click();
  await expect(page.getByRole("heading", { name: "Welcome back, Kevin." })).toBeVisible();
  await expectNoPageOverflow(page);
  await expectNoSeriousAccessibilityViolations(page);
});

test("the DM can enter a scenario and reach an accessible battle-map shell", async ({ page }) => {
  await enterFirstScenarioAsDm(page);
  await expect(page.getByLabel("Map tools and encounter status")).toBeVisible();
  await page.locator("summary[aria-label='UI Settings']").click();
  await expect(page.getByLabel("Colored token centers")).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});

test("blocking dialogs contain focus, inert the map, close on Escape, and restore the launcher", async ({ page }) => {
  await enterFirstScenarioAsDm(page);
  const launcher = page.getByRole("button", { name: "Manage current scenario" });
  await launcher.click();
  const dialog = page.getByRole("dialog", { name: "Scenario details" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  expect(await page.locator(".workspace").evaluate((element) => (element as HTMLElement).inert)).toBe(true);
  await expectNoSeriousAccessibilityViolations(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(launcher).toBeFocused();
});

test("dirty workshop exits are explicit and preserve the draft when cancelled", async ({ page }) => {
  await enterFirstScenarioAsDm(page);
  await page.getByRole("button", { name: "Open Map Workshop" }).click();
  await expect(page.getByText("Map workshop", { exact: true })).toBeVisible();
  const description = page.getByLabel("Description");
  await description.fill("Browser-only unsaved draft");
  await expect(page.getByText("Private changes", { exact: true })).toBeVisible();

  const returnButton = page.getByRole("button", { name: "Return to battle map" });
  await returnButton.click();
  const guard = page.getByRole("dialog", { name: "Return without applying?" });
  await expect(guard).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep editing" })).toBeFocused();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(returnButton).toBeFocused();
  await expect(description).toHaveValue("Browser-only unsaved draft");

  await returnButton.click();
  await page.getByRole("button", { name: "Discard and return" }).click();
  await expect(page.getByLabel("Map tools and encounter status")).toBeVisible();
});

test("clear drawings confirms, supports undo and redo, and preserves unrelated map state", async ({ page }) => {
  await enterFirstScenarioAsDm(page);
  const originalCount = await durableDrawingCount(page);
  const map = page.getByRole("img", { name: /battle grid with .* visible tokens/i });
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
    await enterFirstScenarioAsDm(page);
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
    await enterFirstScenarioAsDm(page);
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
    await enterFirstScenarioAsDm(page);
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
