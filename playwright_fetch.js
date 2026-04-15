#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const command = process.argv[2] || "fetch";
const targetUrl = process.argv[3];
const profileDir = process.env.PLAYWRIGHT_PROFILE_DIR || path.join(__dirname, ".playwright-profile", "immoscout");
const defaultUserAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
let chromiumModule;

function emit(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function hasProfileData() {
  if (!fs.existsSync(profileDir)) return false;
  const entries = fs.readdirSync(profileDir).filter((name) => !name.startsWith("."));
  return entries.length > 0;
}

function getProfileInfo() {
  return {
    profileDir,
    profileReady: hasProfileData(),
  };
}

function loadChromium() {
  if (chromiumModule) return { ok: true, chromium: chromiumModule };
  try {
    ({ chromium: chromiumModule } = require("playwright"));
    return { ok: true, chromium: chromiumModule };
  } catch (error) {
    return {
      ok: false,
      error: "Playwright is not installed. Run `npm install` in the project folder first.",
      details: String(error && error.message ? error.message : error),
      hint: "Installiere zuerst die Node-Abhaengigkeiten mit `npm install`.",
    };
  }
}

function ensureBrowserRuntime(chromium) {
  try {
    const executablePath = chromium.executablePath();
    if (!executablePath || !fs.existsSync(executablePath)) {
      return {
        ok: false,
        error: "Playwright browser runtime is missing.",
        details: executablePath ? `Missing executable: ${executablePath}` : "Chromium executable path is empty.",
        hint: "Fuehre `npm run playwright:install` im Projektordner aus, damit Chromium fuer Playwright installiert wird.",
      };
    }
    return { ok: true, executablePath };
  } catch (error) {
    return {
      ok: false,
      error: "Playwright browser runtime is not ready.",
      details: String(error && error.message ? error.message : error),
      hint: "Fuehre `npm run playwright:install` im Projektordner aus, damit Chromium fuer Playwright installiert wird.",
    };
  }
}

function getRuntimeStatus() {
  const moduleStatus = loadChromium();
  if (!moduleStatus.ok) return moduleStatus;
  const browserStatus = ensureBrowserRuntime(moduleStatus.chromium);
  if (!browserStatus.ok) return browserStatus;
  return {
    ok: true,
    chromium: moduleStatus.chromium,
    executablePath: browserStatus.executablePath,
  };
}

function emitRuntimeUnavailable(result) {
  emit({
    ok: false,
    fetchMode: command === "fetch" ? "playwright" : undefined,
    profileDir,
    profileReady: hasProfileData(),
    ...result,
  });
  process.exitCode = 1;
}

async function dismissCookieBanner(page) {
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
}

function classifySession(pageUrl, bodyText, cookies) {
  const text = String(bodyText || "").toLowerCase();
  const currentUrl = String(pageUrl || "").toLowerCase();
  const authCookieNames = new Set(["SSO", "SSO-HMAC", "websessionid", "g_csrf_token", "x-xsrf-membership-token"]);
  const hasAuthCookie = (cookies || []).some((cookie) => authCookieNames.has(cookie.name));
  const loginMarkers = ["anmelden", "einloggen", "login", "authwall", "captcha", "zugriff verweigert"];
  const hasLoginMarker = loginMarkers.some((marker) => text.includes(marker));
  const looksLoggedIn =
    text.includes("meine suche") ||
    text.includes("mein konto") ||
    text.includes("merkzettel") ||
    text.includes("gespeicherte suchen");

  if (looksLoggedIn || (hasAuthCookie && !hasLoginMarker && !currentUrl.includes("login"))) return "connected";
  if (hasAuthCookie) return "reconnect_needed";
  return "login_required";
}

async function withContext({ headed }, fn) {
  const runtimeStatus = getRuntimeStatus();
  if (!runtimeStatus.ok) {
    emitRuntimeUnavailable(runtimeStatus);
    return;
  }
  const chromium = runtimeStatus.chromium;

  fs.mkdirSync(profileDir, { recursive: true });

  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: !headed,
      args: ["--disable-blink-features=AutomationControlled"],
      viewport: { width: 1440, height: 1100 },
      locale: "de-DE",
      userAgent: defaultUserAgent,
    });
    await fn(context);
  } catch (error) {
    emit({
      ok: false,
      error: `Playwright ${command} failed.`,
      details: String(error && error.message ? error.message : error),
      fetchMode: command === "fetch" ? "playwright" : undefined,
    });
    process.exitCode = 1;
  } finally {
    if (context) {
      await context.close().catch(() => null);
    }
  }
}

async function runFetch() {
  if (!targetUrl) {
    emit({ ok: false, error: "Missing URL argument." });
    process.exitCode = 1;
    return;
  }

  await withContext({ headed: false }, async (context) => {
    const page = context.pages()[0] || (await context.newPage());
    const response = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    await page.waitForSelector("body", { timeout: 10000 });
    await dismissCookieBanner(page);

    const readinessSelectors = ["text=Kaufpreis", "text=Wohnfläche", "#common-content-section", 'a[href*="/expose/"]'];
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
        "Playwright-Fallback verwendet. Die gespeicherte ImmoScout-Sitzung auf dem Server wurde fuer diesen Abruf genutzt.",
    });
  });
}

async function runStatus() {
  const runtimeStatus = getRuntimeStatus();
  if (!runtimeStatus.ok) {
    emit({
      ok: true,
      authState: "unavailable",
      connected: false,
      browserReady: false,
      ...getProfileInfo(),
      hint: runtimeStatus.hint || runtimeStatus.error,
      details: runtimeStatus.details,
    });
    return;
  }

  if (!hasProfileData()) {
    emit({
      ok: true,
      authState: "login_required",
      connected: false,
      browserReady: true,
      executablePath: runtimeStatus.executablePath,
      ...getProfileInfo(),
      hint: "Noch keine gespeicherte ImmoScout-Sitzung vorhanden.",
    });
    return;
  }

  await withContext({ headed: false }, async (context) => {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto("https://www.immobilienscout24.de/meinkonto/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("body", { timeout: 10000 });
    await dismissCookieBanner(page);
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => null);

    const cookies = await context.cookies(["https://www.immobilienscout24.de/"]);
    const bodyText = await page.evaluate(() => document.body?.innerText || "");
    const authState = classifySession(page.url(), bodyText, cookies);

    emit({
      ok: true,
      authState,
      connected: authState === "connected",
      browserReady: true,
      executablePath: runtimeStatus.executablePath,
      ...getProfileInfo(),
      finalUrl: page.url(),
      hint:
        authState === "connected"
          ? "ImmoScout-Sitzung ist verbunden."
          : "ImmoScout-Sitzung ist vorhanden, muss aber erneut verbunden werden.",
    });
  });
}

async function runConnect() {
  await withContext({ headed: true }, async (context) => {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto("https://www.immobilienscout24.de/meinkonto/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("body", { timeout: 10000 });
    await dismissCookieBanner(page);

    const timeoutAt = Date.now() + 180000;
    let authState = "login_required";

    while (Date.now() < timeoutAt) {
      await page.waitForTimeout(2000);
      const cookies = await context.cookies(["https://www.immobilienscout24.de/"]);
      const bodyText = await page.evaluate(() => document.body?.innerText || "");
      authState = classifySession(page.url(), bodyText, cookies);
      if (authState === "connected") break;
    }

    emit({
      ok: authState === "connected",
      authState,
      connected: authState === "connected",
      browserReady: true,
      ...getProfileInfo(),
      finalUrl: page.url(),
      hint:
        authState === "connected"
          ? "ImmoScout-Verbindung gespeichert. Die Sitzung wird fuer weitere Abrufe wiederverwendet."
          : "Keine gueltige ImmoScout-Sitzung erkannt. Bitte Login im geoeffneten Browser abschliessen und erneut versuchen.",
    });

    if (authState !== "connected") process.exitCode = 1;
  });
}

async function runReset() {
  fs.rmSync(profileDir, { recursive: true, force: true });
  const runtimeStatus = getRuntimeStatus();
  emit({
    ok: true,
    authState: runtimeStatus.ok ? "login_required" : "unavailable",
    connected: false,
    browserReady: runtimeStatus.ok,
    ...getProfileInfo(),
    hint: runtimeStatus.ok
      ? "Gespeicherte ImmoScout-Sitzung wurde lokal entfernt."
      : runtimeStatus.hint || "Gespeicherte ImmoScout-Sitzung wurde lokal entfernt.",
    details: runtimeStatus.ok ? undefined : runtimeStatus.details,
  });
}

async function main() {
  if (command === "fetch") {
    await runFetch();
    return;
  }
  if (command === "status") {
    await runStatus();
    return;
  }
  if (command === "connect") {
    await runConnect();
    return;
  }
  if (command === "reset") {
    await runReset();
    return;
  }

  emit({ ok: false, error: `Unknown command: ${command}` });
  process.exitCode = 1;
}

main();
