import { test, expect, type Page } from "@playwright/test";

export async function mockWalletConnect(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__MOCK_WALLET__ = {
      address: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
      publicKey: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
      connected: true,
    };
  });
}

export async function openCommandPalette(page: Page) {
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
}

export async function searchCommand(page: Page, query: string) {
  const input = page.getByPlaceholder("Type a command or search...");
  await input.fill(query);
}

export async function selectFirstResult(page: Page) {
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
}

export async function waitForDashboardReady(page: Page) {
  await page.waitForSelector("[data-testid=\"widget-volume\"]", { timeout: 10000 });
}

export const TEST_USER = {
  email: "test@example.com",
  password: "TestPassword123!",
};
