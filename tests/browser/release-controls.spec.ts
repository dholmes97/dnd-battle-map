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
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

async function openHydratedApplication(page: Page) {
  const encounterList = page.waitForResponse((response) =>
    response.url().endsWith("/api/encounters") && response.request().method() === "GET");
  await page.goto("/");
  await encounterList;
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
  await openHydratedApplication(page);
  await page.getByRole("button", { name: /Kevin.*Dungeon Master/ }).click();
  await expect(page.getByRole("heading", { name: "Welcome back, Kevin." })).toBeVisible();
  await page.getByRole("button", { name: "Open scenario" }).first().click();

  await expect(page.getByRole("img", { name: /battle grid with .* visible tokens/i })).toBeVisible();
  await expect(page.getByLabel("Map tools and encounter status")).toBeVisible();
  await page.locator("summary[aria-label='UI Settings']").click();
  await expect(page.getByLabel("Colored token centers")).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});
