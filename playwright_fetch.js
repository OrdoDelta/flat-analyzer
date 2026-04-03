#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function emit(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function main() {
  const targetUrl = process.argv[2];
  if (!targetUrl) {
    emit({ ok: false, error: "Missing URL argument." });
    process.exitCode = 1;
    return;
  }

  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch (error) {
    emit({
      ok: false,
      error: "Playwright is not installed. Run `npm install` in the project folder first.",
      details: String(error && error.message ? error.message : error),
    });
    process.exitCode = 1;
    return;
  }

  const userDataDir = path.join(__dirname, ".playwright-profile", "immoscout");
  fs.mkdirSync(userDataDir, { recursive: true });

  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: ["--disable-blink-features=AutomationControlled"],
      viewport: { width: 1440, height: 1100 },
      locale: "de-DE",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    });

    const page = context.pages()[0] || (await context.newPage());
    const response = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    await page.waitForSelector("body", { timeout: 10000 });

    const cookieSelectors = [
      'button:has-text("Akzeptieren")',
      'button:has-text("Alle akzeptieren")',
      'button:has-text("Accept")',
      '[data-testid*="accept"]',
    ];
    for (const selector of cookieSelectors) {
      try {
        await page.click(selector, { timeout: 1500 });
        break;
      } catch (_error) {}
    }

    const readinessSelectors = [
      "text=Kaufpreis",
      "text=Wohnfläche",
      "#common-content-section",
      'a[href*="/expose/"]',
    ];
    await Promise.any(
      readinessSelectors.map((selector) =>
        page.waitForSelector(selector, { timeout: 12000 }).catch(() => {
          throw new Error(`Selector not found: ${selector}`);
        }),
      ),
    ).catch(() => null);

    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => null);

    const html = await page.content();
    emit({
      ok: true,
      status: response ? response.status() : 200,
      finalUrl: page.url(),
      html,
      fetchMode: "playwright",
      hint:
        "Playwright-Fallback verwendet. Falls beim ersten Mal ein Browserfenster erscheint, melde dich dort einmalig an; die Sitzung wird lokal gespeichert.",
    });
  } catch (error) {
    emit({
      ok: false,
      error: "Playwright fetch failed.",
      details: String(error && error.message ? error.message : error),
      fetchMode: "playwright",
      hint:
        "Playwright konnte die Seite nicht laden. Falls ein Browserfenster aufgeht, prüfe Login, Cookie-Banner oder Schutzseite und versuche es erneut.",
    });
    process.exitCode = 1;
  } finally {
    if (context) {
      await context.close().catch(() => null);
    }
  }
}

main();
