import { expect, test } from '@playwright/test';

const VALID_CONTRACT_ADDRESS = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

test.describe('SoroTask critical paths', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tasks/create');
  });

  test('connects a mock wallet', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Create Automation Task' })).toBeVisible();

    await page.getByTestId('connect-wallet-button').click();

    await expect(page.getByTestId('wallet-connected-button')).toBeVisible();
    await expect(page.getByTestId('wallet-connected-button')).toContainText('Futurenet');
  });

  test('fills out and submits the task creation form', async ({ page }) => {
    await page.getByTestId('connect-wallet-button').click();
    await expect(page.getByTestId('wallet-connected-button')).toBeVisible();

    await page.getByLabel('Target Contract Address').fill(VALID_CONTRACT_ADDRESS);
    await page.getByLabel('Function Name').fill('harvest_yield');
    await page.getByLabel('Interval (seconds)').fill('3600');
    await page.getByLabel('Gas Balance (XLM)').fill('10');

    const registerButton = page.getByRole('button', { name: /Register Task/i });
    await expect(registerButton).toBeEnabled();
    await registerButton.click();

    await expect(page.getByText('Task created successfully!')).toBeVisible();
  });
});
