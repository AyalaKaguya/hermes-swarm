import { chromium } from "playwright";

const BASE = "http://localhost:3200";
const API = "http://localhost:3100";

async function main() {
  const health = await fetch(`${API}/api/health`).then((r) => r.json());
  console.log("API health:", health);

  const browser = await chromium.launch({
    executablePath:
      "/home/ayala/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell",
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "/tmp/hermes-login.png" });

  const emailInput = page.locator('input[name="email"], input[aria-label="邮箱"], input[type="email"]').first();
  const passwordInput = page.locator('input[name="password"], input[aria-label="密码"], input[type="password"]').first();
  const submitBtn = page.locator('button[type="submit"], button:has-text("登录")').first();

  if (await emailInput.isVisible()) {
    await emailInput.fill("admin@hermes.local");
    await passwordInput.fill("admin123");
    await submitBtn.click();
    await page.waitForTimeout(2000);
    await page.waitForURL("**/organizations", { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }

  await page.screenshot({ path: "/tmp/hermes-org-users.png" });
  console.log("Users tab screenshot saved");

  const invitesTab = page.locator('button:has-text("邀请"), [role="tab"]:has-text("邀请")').first();
  if (await invitesTab.isVisible()) {
    await invitesTab.click();
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: "/tmp/hermes-org-invites.png" });
  console.log("Invites tab screenshot saved");

  await browser.close();
  console.log("Done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
