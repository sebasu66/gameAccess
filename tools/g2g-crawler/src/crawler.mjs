import { chromium } from "playwright";
import fs from "node:fs/promises";

const inputUrl = process.argv[2] || "https://www.g2g.com/";
const outputPath = process.argv[3] || "g2g-offers.json";
const maxOffers = Math.max(1, Math.min(Number(process.env.G2G_MAX_OFFERS || 50), 200));
const maxScrolls = Math.max(0, Math.min(Number(process.env.G2G_MAX_SCROLLS || 8), 30));
const headed = process.env.G2G_HEADED === "1";

function clean(value, max = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function htmlToText(value) {
  return clean(String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'"));
}

function parsePrice(text) {
  const match = text.match(/(?:([0-9][0-9.,]*)\s*(USD|US\$|ARS|EUR|GBP|\$|€|£)|(USD|US\$|ARS|EUR|GBP|\$|€|£)\s*([0-9][0-9.,]*))/i);
  if (!match) return null;
  const rawAmount = match[1] || match[4];
  const rawCurrency = match[2] || match[3];
  const amount = Number(rawAmount.includes(",") && rawAmount.includes(".")
    ? rawAmount.lastIndexOf(",") > rawAmount.lastIndexOf(".")
      ? rawAmount.replace(/\./g, "").replace(",", ".")
      : rawAmount.replace(/,/g, "")
    : rawAmount.replace(",", "."));
  if (!Number.isFinite(amount)) return null;
  return { amount, currency: rawCurrency.toUpperCase().replace("US$", "USD"), raw: clean(match[0], 80) };
}

function parseOffersFromHtml(html, baseUrl) {
  const offers = [];
  const seen = new Set();
  const anchorPattern = /<a\b[^>]*href=["']([^"']*\/offer\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const url = new URL(match[1], baseUrl).href;
    if (seen.has(url)) continue;
    const text = htmlToText(match[2]);
    const price = parsePrice(text);
    if (!price) continue;
    const title = text.split(/\s{2,}/)[0].slice(0, 180) || "G2G listing";
    seen.add(url);
    offers.push({ title, url, price, text: text.slice(0, 700), extraction: "rendered-html-anchor" });
    if (offers.length >= maxOffers) break;
  }
  return offers;
}

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({
  locale: "en-US",
  viewport: { width: 1440, height: 1000 },
  userAgent: "gameAccess procurement research crawler/0.3"
});

try {
  const response = await page.goto(inputUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3000);
  for (let index = 0; index < maxScrolls; index += 1) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(800);
  }

  const html = await page.content();
  const offers = parseOffersFromHtml(html, page.url());
  const result = {
    source: "g2g",
    url: page.url(),
    scrapedAt: new Date().toISOString(),
    offers,
    diagnostics: {
      httpStatus: response?.status() ?? null,
      htmlBytes: Buffer.byteLength(html, "utf8"),
      offerAnchorCount: (html.match(/<a\b[^>]*href=["'][^"']*\/offer\//gi) || []).length,
      scrolls: maxScrolls,
      extraction: "Playwright rendered page.content() + HTML parser",
      ...(offers.length ? {} : { warning: "No priced offer anchors found in rendered HTML." })
    }
  };
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
