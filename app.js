const STORAGE_KEYS = {
  offers: "flat_analyzer_offers_v1",
  settings: "flat_analyzer_settings_v1",
};

const THEME_STORAGE_KEY = "flat_analyzer_theme_v1";
const THEME_DEFAULT = "light";

const LOCALE = "de-DE";
const FETCH_ENDPOINT = "/api/fetch";

const DEFAULT_SETTINGS = {
  purchaseCostsPct: 10.0,
  targetYield: 0.05,
  green: { maxPricePerSqm: 4500, minYield: 0.05, maxMultiplier: 20 },
  yellow: { maxPricePerSqm: 5500, minYield: 0.04, maxMultiplier: 25 },
};

/** @typedef {{id:string,title:string,url?:string,price:number,sqm:number,monthlyRent?:number,monthlyUtilities?:number,monthlyReserve?:number,description?:string,notes?:string,source?:string,createdAt:number}} Offer */

const $ = (id) => document.getElementById(id);

function readThemeSetting() {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
    return THEME_DEFAULT;
  } catch {
    return THEME_DEFAULT;
  }
}

function writeThemeSetting(setting) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, setting);
  } catch {
    // ignore (e.g., localStorage blocked)
  }
}

function resolveTheme(setting, prefersDark) {
  if (setting === "system") return prefersDark ? "dark" : "light";
  return setting === "dark" ? "dark" : "light";
}

function applyTheme(setting, prefersDark) {
  const theme = resolveTheme(setting, prefersDark);
  document.documentElement.dataset.themeSetting = setting;
  document.documentElement.dataset.theme = theme;
}

function initThemeControls() {
  const select = $("themeSelect");
  if (!select) return;

  const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  let setting = readThemeSetting();
  select.value = setting;
  applyTheme(setting, media?.matches ?? false);

  select.addEventListener("change", () => {
    setting = select.value === "dark" || select.value === "system" ? select.value : "light";
    writeThemeSetting(setting);
    applyTheme(setting, media?.matches ?? false);
  });

  if (!media) return;
  const onMediaChange = () => {
    if (setting !== "system") return;
    applyTheme(setting, media.matches);
  };

  if (typeof media.addEventListener === "function") media.addEventListener("change", onMediaChange);
  else if (typeof media.addListener === "function") media.addListener(onMediaChange);
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function uid() {
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

function formatEuro(value) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

function formatPercent(value, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(LOCALE, {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function toHostLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function clampNonNegative(n) {
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, n);
}

function computeMetrics(offer, settings) {
  const purchaseMultiplier = 1 + (settings.purchaseCostsPct || 0) / 100;
  const totalCost = offer.price * purchaseMultiplier;
  const pricePerSqm = offer.sqm > 0 ? offer.price / offer.sqm : undefined;
  const annualRent = offer.monthlyRent && offer.monthlyRent > 0 ? offer.monthlyRent * 12 : undefined;
  const grossYield = annualRent ? annualRent / totalCost : undefined;
  const rentMultiplier = annualRent ? totalCost / annualRent : undefined;
  const priceForTargetYield =
    annualRent && annualRent > 0 && settings.targetYield && settings.targetYield > 0
      ? annualRent / settings.targetYield / purchaseMultiplier
      : undefined;

  return { purchaseMultiplier, totalCost, pricePerSqm, annualRent, grossYield, rentMultiplier, priceForTargetYield };
}

function evaluateOffer(offer, settings) {
  const reasons = [];
  const { pricePerSqm, grossYield, rentMultiplier } = computeMetrics(offer, settings);

  const missing = [];
  if (!Number.isFinite(pricePerSqm)) missing.push("€/m²");
  if (!Number.isFinite(grossYield)) missing.push("Miete/Rendite");
  if (!Number.isFinite(rentMultiplier)) missing.push("Kaufpreisfaktor");
  if (missing.length > 0) {
    return {
      color: "gray",
      label: "Unvollständig",
      reasons: [`Fehlt: ${missing.join(", ")}`],
      metrics: { pricePerSqm, grossYield, rentMultiplier },
    };
  }

  const isGreen =
    pricePerSqm <= settings.green.maxPricePerSqm &&
    grossYield >= settings.green.minYield &&
    rentMultiplier <= settings.green.maxMultiplier;
  const isYellow =
    pricePerSqm <= settings.yellow.maxPricePerSqm &&
    grossYield >= settings.yellow.minYield &&
    rentMultiplier <= settings.yellow.maxMultiplier;

  if (isGreen) {
    reasons.push("Erfüllt alle grünen Grenzwerte.");
    return { color: "green", label: "Sofort anrufen", reasons, metrics: { pricePerSqm, grossYield, rentMultiplier } };
  }
  if (isYellow) {
    if (pricePerSqm > settings.green.maxPricePerSqm) reasons.push("€/m² liegt über Grün.");
    if (grossYield < settings.green.minYield) reasons.push("Rendite liegt unter Grün.");
    if (rentMultiplier > settings.green.maxMultiplier) reasons.push("Kaufpreisfaktor liegt über Grün.");
    return { color: "yellow", label: "Anschauen", reasons, metrics: { pricePerSqm, grossYield, rentMultiplier } };
  }

  if (pricePerSqm > settings.yellow.maxPricePerSqm) reasons.push("€/m² zu hoch.");
  if (grossYield < settings.yellow.minYield) reasons.push("Rendite zu niedrig.");
  if (rentMultiplier > settings.yellow.maxMultiplier) reasons.push("Kaufpreisfaktor zu hoch.");
  return { color: "red", label: "Nein", reasons, metrics: { pricePerSqm, grossYield, rentMultiplier } };
}

function scoreRank(color) {
  if (color === "green") return 0;
  if (color === "yellow") return 1;
  if (color === "red") return 2;
  return 3; // gray
}

function renderCard(offer, settings, { compact = false } = {}) {
  const evalResult = evaluateOffer(offer, settings);
  const { pricePerSqm, grossYield, rentMultiplier, annualRent, priceForTargetYield } = computeMetrics(offer, settings);
  const dotClass = evalResult.color;
  const missingFields = [];
  if (!Number.isFinite(offer.price)) missingFields.push("Kaufpreis");
  if (!Number.isFinite(offer.sqm)) missingFields.push("Wohnfläche");
  if (!Number.isFinite(offer.monthlyRent)) missingFields.push("Miete");
  const missingHtml = compact && missingFields.length ? `<div class="card-meta">Fehlende Angaben: ${escapeHtml(missingFields.join(", "))}</div>` : "";

  const urlHtml = offer.url
    ? `<a href="${escapeHtmlAttr(offer.url)}" target="_blank" rel="noreferrer">Öffnen</a>`
    : `<span class="muted small">Keine URL</span>`;

  const notesHtml = offer.notes ? `<div class="reasons">${escapeHtml(offer.notes)}</div>` : "";
  const descriptionText = normalizeWhitespace(offer.description || "");
  const descriptionHtml = descriptionText
    ? `<div class="reasons">${escapeHtml(descriptionText.length > 260 ? descriptionText.slice(0, 260) + "…" : descriptionText)}</div>`
    : "";
  const reasons = evalResult.reasons.length ? evalResult.reasons.join(" ") : "";
  const reasonsHtml = reasons ? `<div class="card-meta">${escapeHtml(reasons)}</div>` : "";
  const sourceTagHtml = offer.source ? `<span class="meta-pill">${escapeHtml(offer.source)}</span>` : "";
  const hostTagHtml = offer.url ? `<span class="meta-pill">${escapeHtml(toHostLabel(offer.url))}</span>` : "";

  const editButtonHtml = compact
    ? ""
    : `<button class="icon-btn icon-btn--small" type="button" data-action="edit" data-id="${offer.id}" aria-label="Bearbeiten" title="Bearbeiten">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
      </button>`;

  return `
    <article class="card" data-id="${offer.id}">
      <div class="card-head">
        <div class="card-head-main">
          <h3>${escapeHtml(offer.title || "Ohne Titel")}</h3>
          <div class="row card-links">
            ${urlHtml}
          </div>
        </div>
        <div class="card-head-right">
          ${editButtonHtml}
          <div class="badge badge--${dotClass}" title="${escapeHtmlAttr(evalResult.label)}">
            <span class="dot ${dotClass}"></span>
            <span>${escapeHtml(evalResult.label)}</span>
          </div>
        </div>
      </div>
      <div class="card-hero">
        <div class="hero-metric hero-metric--price">
          <div class="k">Kaufpreis</div>
          <div class="hero-value">${formatEuro(offer.price)}</div>
        </div>
        <div class="hero-metric">
          <div class="k">Bruttorendite</div>
          <div class="hero-value">${formatPercent(grossYield)}</div>
        </div>
        <div class="hero-metric">
          <div class="k">€/m²</div>
          <div class="hero-value">${formatEuro(pricePerSqm)}</div>
        </div>
      </div>
      <div class="card-meta-row">
        ${hostTagHtml}
        ${sourceTagHtml}
      </div>
      ${missingHtml}
      <div class="kv card-kv">
        <div>
          <div class="k">Wohnfläche</div>
          <div class="v">${formatNumber(offer.sqm, 2)} m²</div>
        </div>
        <div>
          <div class="k">Monatsmiete</div>
          <div class="v">${formatEuro(offer.monthlyRent)}</div>
        </div>
        <div>
          <div class="k">Jahresmiete</div>
          <div class="v">${formatEuro(annualRent)}</div>
        </div>
        <div>
          <div class="k">Maximaler Kaufpreis bei ${formatPercent(settings.targetYield, 0)} Rendite</div>
          <div class="v">${formatEuro(priceForTargetYield)}</div>
        </div>
        <div>
          <div class="k">Kaufpreisfaktor</div>
          <div class="v">${formatNumber(rentMultiplier, 2)}×</div>
        </div>
        <div>
          <div class="k">Nebenkosten</div>
          <div class="v">${formatEuro(offer.monthlyUtilities)}</div>
        </div>
        <div>
          <div class="k">Rücklagen</div>
          <div class="v">${formatEuro(offer.monthlyReserve)}</div>
        </div>
      </div>
      ${reasonsHtml}
      ${descriptionHtml}
      ${notesHtml}
    </article>
  `;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeHtmlAttr(str) {
  return escapeHtml(str).replaceAll("\n", " ");
}

function normalizeWhitespace(text) {
  return String(text || "")
    .replaceAll("\u00a0", " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseGermanNumber(raw) {
  if (!raw) return undefined;
  const cleaned = String(raw)
    .replaceAll("\u00a0", " ")
    .replace(/[^\d,.\s]/g, "")
    .trim();
  if (!cleaned) return undefined;

  // Common German formats: 1.234.567,89 or 1234,56
  const noSpaces = cleaned.replace(/\s+/g, "");
  const hasComma = noSpaces.includes(",");
  const normalized = hasComma ? noSpaces.replaceAll(".", "").replace(",", ".") : noSpaces.replaceAll(".", "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
}

function extractEuroAmount(text) {
  const t = normalizeWhitespace(text);
  const match = t.match(/(\d[\d\s.,]*)\s*€/) || t.match(/€\s*(\d[\d\s.,]*)/);
  if (!match) return undefined;
  return clampNonNegative(parseGermanNumber(match[1]));
}

function extractAllEuroAmounts(text) {
  const t = normalizeWhitespace(text);
  const matches = [...t.matchAll(/(\d[\d\s.,]*)\s*€/g)].map((m) => clampNonNegative(parseGermanNumber(m[1])));
  return matches.filter((n) => Number.isFinite(n) && n > 0);
}

function bestEffortPrice(text) {
  const t = normalizeWhitespace(text);
  const labeled = [
    /kaufpreis[^€]{0,40}(\d[\d\s.,]*)\s*€/i,
    /preis[^€]{0,40}(\d[\d\s.,]*)\s*€/i,
  ];
  for (const re of labeled) {
    const m = t.match(re);
    if (m) {
      const n = clampNonNegative(parseGermanNumber(m[1]));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }

  const all = extractAllEuroAmounts(t);
  if (!all.length) return undefined;
  // Heuristic: price is usually the largest € amount on the card.
  return Math.max(...all);
}

function extractSqm(text) {
  const t = normalizeWhitespace(text);
  const match = t.match(/(\d[\d\s.,]*)\s*m²/i);
  if (!match) return undefined;
  return clampNonNegative(parseGermanNumber(match[1]));
}

function bestEffortRent(text) {
  const t = normalizeWhitespace(text);
  const candidates = [];

  const labeled = [
    /mieteinnahmen[^€]{0,40}(\d[\d\s.,]*)\s*€/i,
    /kaltmiete[^€]{0,40}(\d[\d\s.,]*)\s*€/i,
    /miete[^€]{0,40}(\d[\d\s.,]*)\s*€/i,
  ];
  for (const re of labeled) {
    const m = t.match(re);
    if (m) candidates.push(parseGermanNumber(m[1]));
  }

  const fallback = extractEuroAmount(t);
  if (Number.isFinite(fallback)) candidates.push(fallback);

  const filtered = candidates.map(clampNonNegative).filter((n) => Number.isFinite(n) && n > 0);
  if (!filtered.length) return undefined;

  // Heuristic: rents usually smaller than prices; pick the smallest meaningful € amount.
  return Math.min(...filtered);
}

function parseOffersFromJson(text) {
  const data = JSON.parse(text);
  const offers = Array.isArray(data) ? data : Array.isArray(data?.offers) ? data.offers : [];
  return offers
    .map((o) => ({
      id: uid(),
      title: String(o.title || o.name || "Importiertes Angebot"),
      url: o.url ? String(o.url) : undefined,
      price: Number(o.price),
      sqm: Number(o.sqm || o.area || o.livingArea),
      monthlyRent: o.monthlyRent != null ? Number(o.monthlyRent) : undefined,
      monthlyUtilities: o.monthlyUtilities != null ? Number(o.monthlyUtilities) : undefined,
      monthlyReserve: o.monthlyReserve != null ? Number(o.monthlyReserve) : undefined,
      description: o.description ? String(o.description) : undefined,
      notes: o.notes ? String(o.notes) : undefined,
      source: o.source ? String(o.source) : "import-json",
      createdAt: Date.now(),
    }))
    .filter((o) => Number.isFinite(o.price) && Number.isFinite(o.sqm));
}

function parseOffersFromHtml(htmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, "text/html");

  // Special-case: single ImmoScout expose pages often contain everything we need, but not a list of cards.
  // If the canonical URL is an expose, parse from the full document.
  const canonicalUrl = doc.querySelector('link[rel="canonical"]')?.getAttribute("href") || "";
  if (canonicalUrl.includes("/expose/")) {
    const pageText = normalizeWhitespace(doc.body?.textContent || "");
    const title =
      normalizeWhitespace(doc.querySelector('meta[property="og:title"]')?.getAttribute("content") || "") ||
      normalizeWhitespace(doc.title || "") ||
      "ImmoScout Exposé";

    const descriptionParts = [];
    const objDesc = normalizeWhitespace(doc.querySelector(".is24qa-objektbeschreibung")?.textContent || "");
    const Ausstattung = normalizeWhitespace(doc.querySelector(".is24qa-ausstattung")?.textContent || "");
    const Lage = normalizeWhitespace(doc.querySelector(".is24qa-lage")?.textContent || "");
    if (objDesc) descriptionParts.push(`Objektbeschreibung: ${objDesc}`);
    if (Ausstattung) descriptionParts.push(`Ausstattung: ${Ausstattung}`);
    if (Lage) descriptionParts.push(`Lage: ${Lage}`);
    const description = descriptionParts.join("\n\n") || undefined;

    // Prefer structured numbers in scripts if available; otherwise fall back to text heuristics.
    const purchasePriceMatch =
      htmlText.match(/purchasePrice\s*:\s*["']?(\d[\d.,]*)["']?/i) ||
      htmlText.match(/propertyPrice\s*:\s*["']?(\d[\d.,]*)["']?/i) ||
      htmlText.match(/"price"\s*:\s*["']?(\d[\d.,]*)["']?/i);
    const priceFromScript = purchasePriceMatch ? clampNonNegative(parseGermanNumber(purchasePriceMatch[1])) : undefined;
    const price = Number.isFinite(priceFromScript) && priceFromScript > 0 ? priceFromScript : bestEffortPrice(pageText);

    const sqmMatch =
      htmlText.match(/"squareMeters"\s*:\s*(\d+(?:[.,]\d+)?)/i) ||
      htmlText.match(/obj_livingSpace"\s*:\s*"(\d+(?:[.,]\d+)?)"/i) ||
      htmlText.match(/"livingSpace"\s*:\s*"(\d+(?:[.,]\d+)?)"/i);
    const sqmFromScript = sqmMatch ? clampNonNegative(parseGermanNumber(sqmMatch[1])) : undefined;
    const sqm = Number.isFinite(sqmFromScript) && sqmFromScript > 0 ? sqmFromScript : extractSqm(pageText);

    const rentMatch =
      htmlText.match(/baseRent\s*:\s*["']?(\d[\d.,]*)["']?/i) ||
      htmlText.match(/totalRent\s*:\s*["']?(\d[\d.,]*)["']?/i);
    const rentFromScript = rentMatch ? clampNonNegative(parseGermanNumber(rentMatch[1])) : undefined;
    const monthlyRent = Number.isFinite(rentFromScript) && rentFromScript > 0 ? rentFromScript : undefined;

    const hausgeldText = normalizeWhitespace(doc.querySelector(".is24qa-hausgeld")?.textContent || "");
    const monthlyUtilities = extractEuroAmount(hausgeldText);

    if (Number.isFinite(price) && price > 0 && Number.isFinite(sqm) && sqm > 0) {
      return [
        {
          id: uid(),
          title,
          url: canonicalUrl,
          price,
          sqm,
          monthlyRent,
          monthlyUtilities,
          monthlyReserve: undefined,
          description,
          source: "immoscout-expose-html",
          createdAt: Date.now(),
        },
      ];
    }
    // If we can't extract enough, continue with generic parsing below.
  }

  // 1) Try structured data (JSON-LD) first. Many real-estate portals embed an ItemList/Product data blob
  // in the HTML source even when the visible results are rendered client-side.
  const jsonLdOffers = [];
  const jsonLdScripts = [...doc.querySelectorAll('script[type="application/ld+json"]')];
  for (const s of jsonLdScripts) {
    const raw = (s.textContent || "").trim();
    if (!raw) continue;
    try {
      const data = JSON.parse(raw);
      const items = Array.isArray(data) ? data : [data];
      for (const node of items) {
        const graphNodes = Array.isArray(node?.["@graph"]) ? node["@graph"] : null;
        const nodesToScan = graphNodes ? graphNodes : [node];

        for (const n of nodesToScan) {
        // ItemList: { itemListElement: [{ url, name }, ...] }
        if (n && n["@type"] === "ItemList" && Array.isArray(n.itemListElement)) {
          for (const el of n.itemListElement) {
            const url = typeof el?.url === "string" ? el.url : typeof el?.item?.url === "string" ? el.item.url : undefined;
            const title =
              typeof el?.name === "string"
                ? el.name
                : typeof el?.item?.name === "string"
                  ? el.item.name
                  : typeof el?.item?.headline === "string"
                    ? el.item.headline
                    : undefined;
            if (!url) continue;
            jsonLdOffers.push({
              id: uid(),
              title: normalizeWhitespace(title || "Angebot"),
              url,
              price: 0,
              sqm: 0,
              monthlyRent: undefined,
              notes:
                "Aus JSON-LD importiert (Preis/Wohnfläche fehlen im HTML-Quelltext). Öffne das Exposé und ergänze die Zahlen manuell oder füge den vollständig gerenderten DOM ein.",
              source: "jsonld",
              createdAt: Date.now(),
            });
          }
        }

        // Product/Offer-style nodes (best-effort)
        const url = typeof n?.url === "string" ? n.url : undefined;
        const title = typeof n?.name === "string" ? n.name : typeof n?.headline === "string" ? n.headline : undefined;
        const price =
          typeof n?.offers?.price === "number"
            ? n.offers.price
            : typeof n?.offers?.price === "string"
              ? Number(n.offers.price)
              : undefined;
        const sqm =
          typeof n?.floorSize?.value === "number"
            ? n.floorSize.value
            : typeof n?.floorSize?.value === "string"
              ? Number(n.floorSize.value)
              : undefined;
        if (url && title && (Number.isFinite(price) || Number.isFinite(sqm))) {
          jsonLdOffers.push({
            id: uid(),
            title: normalizeWhitespace(title),
            url,
            price: Number.isFinite(price) ? price : 0,
            sqm: Number.isFinite(sqm) ? sqm : 0,
            monthlyRent: undefined,
            source: "jsonld",
            createdAt: Date.now(),
          });
        }
        }
      }
    } catch {
      // ignore broken JSON-LD blobs
    }
  }

  // If JSON-LD gave us at least URLs, keep it as a fallback result.
  const jsonLdDeduped = [];
  const seenJsonLd = new Set();
  for (const o of jsonLdOffers) {
    const key = o.url || o.title;
    if (!key || seenJsonLd.has(key)) continue;
    seenJsonLd.add(key);
    jsonLdDeduped.push(o);
  }

  /** @type {Map<string, Offer>} */
  const byUrl = new Map();
  const anchors = [
    ...doc.querySelectorAll('a[href*="/expose/"]'),
    ...doc.querySelectorAll('a[href*="expose"]'),
  ];

  for (const a of anchors) {
    const href = a.getAttribute("href") || "";
    const url = href.startsWith("http") ? href : href.startsWith("/") ? `https://www.immobilienscout24.de${href}` : href;
    if (!url || url.length < 8) continue;

    // Climb a bit to capture price/area text near the link.
    const container =
      a.closest("article") ||
      a.closest('[role="article"]') ||
      a.closest("li") ||
      a.closest("[data-testid]") ||
      a.closest("div") ||
      a;
    const text = normalizeWhitespace(container.textContent || "");

    const price = bestEffortPrice(text);
    const sqm = extractSqm(text);
    const monthlyRent = bestEffortRent(text);
    const title =
      normalizeWhitespace(a.getAttribute("aria-label") || "") ||
      normalizeWhitespace(a.textContent || "") ||
      "ImmoScout Angebot";

    if (!Number.isFinite(price) || !Number.isFinite(sqm)) continue;

    if (!byUrl.has(url)) {
      byUrl.set(url, {
        id: uid(),
        title,
        url,
        price,
        sqm,
        monthlyRent,
        source: "immoscout-html",
        createdAt: Date.now(),
      });
    }
  }

  const extracted = [...byUrl.values()];
  if (extracted.length > 0) return extracted;

  // Final fallback: if we couldn't extract full price+sqm cards, return JSON-LD URL list if available.
  return jsonLdDeduped;
}

function parseImportText(text) {
  const t = (text || "").trim();
  if (!t) return [];
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return parseOffersFromJson(t);
    } catch {
      // fall through to HTML parsing
    }
  }
  return parseOffersFromHtml(t);
}

  function init() {
    initThemeControls();

  /** @type {Offer[]} */
  let offers = loadJson(STORAGE_KEYS.offers, []);
  let settings = { ...DEFAULT_SETTINGS, ...loadJson(STORAGE_KEYS.settings, {}) };
  settings.green = { ...DEFAULT_SETTINGS.green, ...(settings.green || {}) };
  settings.yellow = { ...DEFAULT_SETTINGS.yellow, ...(settings.yellow || {}) };
  settings.targetYield = Number.isFinite(settings.targetYield) ? settings.targetYield : DEFAULT_SETTINGS.targetYield;
  settings.importCookie = typeof settings.importCookie === "string" ? settings.importCookie : "";

  // Views & tabs
  const views = {
    offers: $("viewOffers"),
    import: $("viewImport"),
    settings: $("viewSettings"),
  };

  function setTab(name) {
    const tabButtons = {
      offers: $("tabOffers"),
      import: $("tabImport"),
      settings: $("tabSettings"),
    };
    for (const [k, btn] of Object.entries(tabButtons)) {
      const active = k === name;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    }
    for (const [k, view] of Object.entries(views)) {
      view.classList.toggle("hidden", k !== name);
    }
  }

  $("tabOffers").addEventListener("click", () => setTab("offers"));
  $("tabImport").addEventListener("click", () => setTab("import"));
  $("tabSettings").addEventListener("click", () => setTab("settings"));

  // Settings inputs
  const settingsEls = {
    purchaseCostsPct: $("purchaseCostsPct"),
    targetYield: $("targetYield"),
    greenMaxPricePerSqm: $("greenMaxPricePerSqm"),
    greenMinYield: $("greenMinYield"),
    greenMaxMultiplier: $("greenMaxMultiplier"),
    yellowMaxPricePerSqm: $("yellowMaxPricePerSqm"),
    yellowMinYield: $("yellowMinYield"),
    yellowMaxMultiplier: $("yellowMaxMultiplier"),
    importCookie: $("importCookie"),
  };

  function loadSettingsToUi() {
    settingsEls.purchaseCostsPct.value = String(settings.purchaseCostsPct ?? DEFAULT_SETTINGS.purchaseCostsPct);
    settingsEls.targetYield.value = String(settings.targetYield ?? DEFAULT_SETTINGS.targetYield);
    settingsEls.greenMaxPricePerSqm.value = String(settings.green.maxPricePerSqm);
    settingsEls.greenMinYield.value = String(settings.green.minYield);
    settingsEls.greenMaxMultiplier.value = String(settings.green.maxMultiplier);
    settingsEls.yellowMaxPricePerSqm.value = String(settings.yellow.maxPricePerSqm);
    settingsEls.yellowMinYield.value = String(settings.yellow.minYield);
    settingsEls.yellowMaxMultiplier.value = String(settings.yellow.maxMultiplier);
    settingsEls.importCookie.value = settings.importCookie || "";
  }

  function saveSettingsFromUi() {
    settings.purchaseCostsPct = Number(settingsEls.purchaseCostsPct.value);
    settings.targetYield = Number(settingsEls.targetYield.value);
    settings.green.maxPricePerSqm = Number(settingsEls.greenMaxPricePerSqm.value);
    settings.green.minYield = Number(settingsEls.greenMinYield.value);
    settings.green.maxMultiplier = Number(settingsEls.greenMaxMultiplier.value);
    settings.yellow.maxPricePerSqm = Number(settingsEls.yellowMaxPricePerSqm.value);
    settings.yellow.minYield = Number(settingsEls.yellowMinYield.value);
    settings.yellow.maxMultiplier = Number(settingsEls.yellowMaxMultiplier.value);
    settings.importCookie = settingsEls.importCookie.value.trim();
    saveJson(STORAGE_KEYS.settings, settings);
  }

  $("btnSaveSettings").addEventListener("click", () => {
    saveSettingsFromUi();
    renderOffers();
    const el = $("settingsSaved");
    el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), 1000);
  });

  // Offer dialog
  const dialog = $("offerDialog");
  const offerForm = $("offerForm");

  function openOfferDialog(existing) {
    $("dialogTitle").textContent = existing ? "Angebot bearbeiten" : "Angebot hinzufügen";
    $("offerId").value = existing?.id || "";
    $("offerTitle").value = existing?.title || "";
    $("offerUrl").value = existing?.url || "";
    $("offerPrice").value = existing?.price != null ? String(existing.price) : "";
    $("offerSqm").value = existing?.sqm != null ? String(existing.sqm) : "";
    $("offerMonthlyRent").value = existing?.monthlyRent != null ? String(existing.monthlyRent) : "";
    $("offerMonthlyUtilities").value = existing?.monthlyUtilities != null ? String(existing.monthlyUtilities) : "";
    $("offerMonthlyReserve").value = existing?.monthlyReserve != null ? String(existing.monthlyReserve) : "";
    $("offerNotes").value = existing?.notes || "";
    $("btnDeleteOffer").classList.toggle("hidden", !existing);
    dialog.showModal();
  }

  $("btnAddOffer").addEventListener("click", () => openOfferDialog());

  offerForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const id = $("offerId").value || uid();
    const title = $("offerTitle").value.trim();
    const url = $("offerUrl").value.trim() || undefined;
    const price = Number($("offerPrice").value);
    const sqm = Number($("offerSqm").value);
    const monthlyRentRaw = $("offerMonthlyRent").value.trim();
    const monthlyRent = monthlyRentRaw ? Number(monthlyRentRaw) : undefined;
    const monthlyUtilitiesRaw = $("offerMonthlyUtilities").value.trim();
    const monthlyUtilities = monthlyUtilitiesRaw ? Number(monthlyUtilitiesRaw) : undefined;
    const monthlyReserveRaw = $("offerMonthlyReserve").value.trim();
    const monthlyReserve = monthlyReserveRaw ? Number(monthlyReserveRaw) : undefined;
    const notes = $("offerNotes").value.trim() || undefined;

    if (!title || !Number.isFinite(price) || !Number.isFinite(sqm)) return;

    const idx = offers.findIndex((o) => o.id === id);
    const payload = {
      id,
      title,
      url,
      price,
      sqm,
      monthlyRent,
      monthlyUtilities,
      monthlyReserve,
      notes,
      source: idx >= 0 ? offers[idx].source : "manual",
      createdAt: idx >= 0 ? offers[idx].createdAt : Date.now(),
    };
    if (idx >= 0) offers[idx] = payload;
    else offers.unshift(payload);

    saveJson(STORAGE_KEYS.offers, offers);
    dialog.close();
    renderOffers();
  });

  $("btnDeleteOffer").addEventListener("click", () => {
    const id = $("offerId").value || "";
    if (!id) return;
    if (!confirm("Angebot wirklich löschen?")) return;
    offers = offers.filter((o) => o.id !== id);
    saveJson(STORAGE_KEYS.offers, offers);
    dialog.close();
    renderOffers();
  });

  // Offers rendering, searching, sorting
  function getFilteredSortedOffers() {
    const q = ($("searchInput").value || "").trim().toLowerCase();
    const sort = $("sortSelect").value;
    const filtered = offers.filter((o) => {
      if (!q) return true;
      return (o.title || "").toLowerCase().includes(q) || (o.url || "").toLowerCase().includes(q);
    });

    const withEval = filtered.map((o) => ({ o, ev: evaluateOffer(o, settings) }));

    withEval.sort((a, b) => {
      if (sort === "created_desc") return (b.o.createdAt || 0) - (a.o.createdAt || 0);
      if (sort === "yield_desc") {
        const ay = a.ev.metrics.grossYield;
        const by = b.ev.metrics.grossYield;
        return (Number.isFinite(by) ? by : -Infinity) - (Number.isFinite(ay) ? ay : -Infinity);
      }
      if (sort === "ppsqm_asc") {
        const ap = a.ev.metrics.pricePerSqm;
        const bp = b.ev.metrics.pricePerSqm;
        return (Number.isFinite(ap) ? ap : Infinity) - (Number.isFinite(bp) ? bp : Infinity);
      }
      // score
      const sr = scoreRank(a.ev.color) - scoreRank(b.ev.color);
      if (sr !== 0) return sr;
      const by = b.ev.metrics.grossYield;
      const ay = a.ev.metrics.grossYield;
      return (Number.isFinite(by) ? by : -Infinity) - (Number.isFinite(ay) ? ay : -Infinity);
    });

    return withEval.map((x) => x.o);
  }

  function renderOffers() {
    const grid = $("offersGrid");
    const empty = $("offersEmpty");
    const list = getFilteredSortedOffers();

    empty.classList.toggle("hidden", list.length !== 0);
    grid.innerHTML = list.map((o) => renderCard(o, settings)).join("");

    grid.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const action = btn.getAttribute("data-action");
        const offer = offers.find((o) => o.id === id);
        if (!offer) return;
        if (action === "edit") openOfferDialog(offer);
      });
    });
  }

  $("searchInput").addEventListener("input", renderOffers);
  $("sortSelect").addEventListener("change", renderOffers);

  // Import flow
  let parsedOffers = [];
  let lastImportSource = "manual";
  let importNoticeBase = "";

  function setFetchStatus(message, kind = "muted") {
    const el = $("fetchStatus");
    el.textContent = message || "";
    el.classList.remove("status-error", "status-success");
    if (kind === "error") el.classList.add("status-error");
    if (kind === "success") el.classList.add("status-success");
  }

  function updateServerHint() {
    const hint = $("serverHint");
    const isLocalServer = location.protocol.startsWith("http");
    const localHint = isLocalServer
      ? importNoticeBase
      : "URL-Import braucht den lokalen Server. Starte im Projektordner: python3 server.py und oeffne dann http://127.0.0.1:8000";
    hint.classList.toggle("hidden", !localHint);
    hint.textContent = localHint;
    $("btnFetchUrl").disabled = !isLocalServer;
  }

  function renderImportResults() {
    const panel = $("importResults");
    const grid = $("importGrid");
    $("importCount").textContent = formatNumber(parsedOffers.length, 0);
    panel.classList.remove("hidden");
    const hint = $("importHint");
    if (parsedOffers.length === 0) {
      hint.textContent =
        lastImportSource === "url"
          ? "Keine Angebote gefunden. Falls ImmoScout nur eine Login- oder Schutzseite geliefert hat, hinterlege optional den Cookie in den Einstellungen und versuche es erneut."
          : "Keine Angebote gefunden. Falls die Seite stark per JavaScript gerendert wird, nutze alternativ den HTML-Fallback oder pruefe, ob die URL direkt zum Expose bzw. zur Suchseite fuehrt.";
    } else {
      hint.textContent =
        lastImportSource === "url"
          ? "URL erfolgreich gelesen. Prüfe die Daten kurz und füge dann nur die gewünschten Angebote hinzu."
          : "Analyse abgeschlossen. Prüfe die Daten kurz und füge dann die gewünschten Angebote hinzu.";
    }
    grid.innerHTML = parsedOffers.map((o) => renderCard(o, settings, { compact: true })).join("");
    $("btnAddParsed").disabled = parsedOffers.length === 0;
  }

  $("btnParseImport").addEventListener("click", () => {
    const text = $("importTextarea").value || "";
    lastImportSource = "manual";
    parsedOffers = parseImportText(text);
    renderImportResults();
  });

  $("btnFetchUrl").addEventListener("click", async () => {
    const url = ($("importUrl").value || "").trim();
    if (!url) {
      setFetchStatus("Bitte zuerst eine URL eingeben.", "error");
      return;
    }

    setFetchStatus("URL wird geladen...");
    $("btnFetchUrl").disabled = true;

    try {
      const response = await fetch(FETCH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          cookie: settings.importCookie || "",
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        importNoticeBase = payload?.hint || "";
        const statusInfo = payload?.status ? ` (HTTP ${payload.status})` : "";
        const message =
          payload?.status === 401 || payload?.status === 403
            ? "ImmoScout verweigert den Abruf"
            : payload?.error || "Abruf fehlgeschlagen.";
        throw new Error(`${message}${statusInfo}`);
      }

      $("importTextarea").value = payload.html || "";
      lastImportSource = "url";
      importNoticeBase = "";
      parsedOffers = parseImportText(payload.html || "");
      renderImportResults();
      setFetchStatus(`URL geladen${payload.status ? ` (HTTP ${payload.status})` : ""}.`, "success");
    } catch (error) {
      parsedOffers = [];
      lastImportSource = "url";
      renderImportResults();
      setFetchStatus(error instanceof Error ? error.message : "Abruf fehlgeschlagen.", "error");
    } finally {
      updateServerHint();
    }
  });

  $("importFile").addEventListener("change", () => {
    const input = $("importFile");
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      $("importTextarea").value = text;
      lastImportSource = "file";
      importNoticeBase = "";
      parsedOffers = parseImportText(text);
      renderImportResults();
    };
    reader.readAsText(file);
  });

  $("btnAddParsed").addEventListener("click", () => {
    if (!parsedOffers.length) return;
    const existingUrls = new Set(offers.map((o) => o.url).filter(Boolean));
    const toAdd = parsedOffers.filter((o) => !o.url || !existingUrls.has(o.url));
    offers = [...toAdd, ...offers];
    saveJson(STORAGE_KEYS.offers, offers);
    parsedOffers = [];
    importNoticeBase = "";
    renderImportResults();
    $("importUrl").value = "";
    $("importTextarea").value = "";
    setFetchStatus("");
    renderOffers();
    setTab("offers");
  });

  // Export/reset
  $("btnExport").addEventListener("click", async () => {
    const payload = JSON.stringify({ exportedAt: new Date().toISOString(), settings, offers }, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      alert("Export (JSON) in die Zwischenablage kopiert.");
    } catch {
      prompt("Bitte dieses JSON kopieren:", payload);
    }
  });

  $("btnReset").addEventListener("click", () => {
    if (!confirm("Einstellungen und Angebote in deinem Browser für diese App wirklich löschen?")) return;
    localStorage.removeItem(STORAGE_KEYS.offers);
    localStorage.removeItem(STORAGE_KEYS.settings);
    offers = [];
    settings = structuredClone(DEFAULT_SETTINGS);
    loadSettingsToUi();
    renderOffers();
    alert("Zurücksetzen abgeschlossen.");
  });

  // Initial render
  loadSettingsToUi();
  updateServerHint();
  renderOffers();
  setTab("offers");
}

init();
