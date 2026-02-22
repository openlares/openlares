import { test, expect } from '@playwright/test';

test.describe('App', () => {
  test('loads the dashboard page', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=OpenLares')).toBeVisible();
  });

  test('navigates to settings', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('text=Gateway Settings')).toBeVisible();
  });

  test('shows gateway URL input on settings page', async ({ page }) => {
    await page.goto('/settings');
    const urlInput = page.locator('input[type="text"]').first();
    await expect(urlInput).toBeVisible();
  });

  test('shows "Not connected" state on dashboard when no gateway', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Not connected')).toBeVisible();
  });

  test('settings page has connect button', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('button:has-text("Connect")')).toBeVisible();
  });
});
