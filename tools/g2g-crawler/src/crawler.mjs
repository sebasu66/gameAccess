import { chromium } from "playwright";
import fs from "node:fs/promises";

const inputUrl = process.argv[2] || "https://www.g2g.com/";
const outputPath = process.argv[3] || "g2g-offers.json";
const maxOffers = Math.max(1, Math.min(Number(process.env.G2G_MAX_OFFERS || 50), 200));
const maxScrolls = Math.max(0, Math.min(Number(process.env.G2G_MAX_SCROLLS || 8), 30));
const headed = process.env.G2G_HEADED === "1";

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({
  locale: "es-AR",
  viewport: { width: 1440, height: 1000 },
  userAgent: "gameAccess procurement research crawler/0.1"
});

try {
  await page.goto(inputUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3000);

  const result = await page.evaluate(async ({ maxOffers, maxScrolls }) => {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const clean = (value, max = 500) =>
        .replace(/\s+/g, " ")
    const pricePattern = /(?:(?:US\$|USD|ARS|\$|EUR|€|GBP|£)\s*([0-9][0-9.,]*)|([0-9][0-9.,]*)\s*(?:US\$|USD|ARS|\$|EUR|€|GBP|£))/i;
    const parseAmount = value => {
      const normalized = String(value || "").replace(/\./g, "").replace(",", ".");
      const amount = Number(normalized);
      return Number.isFinite(amount) ? amount : 0;
    };

    const currency = raw => {
      const upper = raw.toUpperCase();
      if (upper.includes("USD") || upper.includes("US$")) return "USD";
      if (upper.includes("ARS")) return "ARS";
      if (upper.includes("EUR") || raw.includes("€")) return "EUR";
      if (upper.includes("GBP") || raw.includes("£")) return "GBP";
      return "$";
    };

    const visible = element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 &&
        style.display !== "none" && style.visibility !== "hidden";
    };

    const candidates = new Map();
    let scrolls = 0;

    // G2G-specific recovery: listing cards are offer anchors, while the
    // amount and currency are separate nested spans.
    const offerAnchors = Array.from(document.querySelectorAll('a[href*="/offer/"]'));
    for (const anchor of offerAnchors) {
      if (candidates.size >= maxOffers) break;
      const text = clean(anchor.innerText);
      const priceBlock = clean(anchor.querySelector("div.min-w-0")?.innerText || text);
      const match = priceBlock.match(pricePattern);
      if (!match) continue;
      const lines = text.split(/\\n|\\r/).map(clean).filter(Boolean);
      const title = lines.find(line => !/^(price|view|buy|sold|min\\.|instant|new listing|\\d+(?:[.,]\\d+)?\\s*USD)$/i.test(line)) || "G2G listing";
      const key = anchor.href + "|" + priceBlock;
      candidates.set(key, {
        title,
        url: anchor.href,
        price: {
          amount: parseAmount(match[1] || match[2]),
          currency: currency(match[0]),
          raw: clean(match[0], 80)
        },
        text,
        extraction: "g2g-offer-anchor"
      });
    }

    for (let index = 0; index <= maxScrolls; index += 1) {
      const nodes = Array.from(document.querySelectorAll(
        'body *'
      )).filter(visible);

      for (const node of nodes) {
        const text = clean(node.innerText);
        const match = text.match(pricePattern);
        if (!match || text.length < 8) continue;

        const anchor = node.querySelector("a[href]");
        const url = anchor?.href || location.href;
        const key = url + "|" + text.slice(0, 180);
        if (candidates.has(key)) continue;

        const title = clean(
          anchor?.innerText ||
          node.querySelector('h1,h2,h3,h4,[class*="title"],[class*="name"]')?.textContent ||
          text.split(/\n|\r/)[0],
          180
        );

        const seller = clean(
          node.querySelector('[class*="seller"],[class*="vendor"],[class*="shop"]')?.textContent,
          120
        );

        candidates.set(key, {
          title: title || "G2G listing",
          url,
          price: {
            amount: parseAmount(match[1] || match[2]),
            currency: currency(match[0]),
            raw: clean(match[0], 80)
          },
          ...(seller ? { seller } : {}),
          text
        });

        if (candidates.size >= maxOffers) break;
      }

      if (candidates.size >= maxOffers || index === maxScrolls) break;
      window.scrollTo(0, document.documentElement.scrollHeight);
      scrolls += 1;
      await sleep(800);
    }

    if (candidates.size === 0) {
      // Snapshot fallback: parse the rendered HTML when the live DOM exposes
      // offer anchors too late or through a hydration boundary.
      const html = document.documentElement.outerHTML;
      const stripTags = value => String(value)
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\\s+/g, " ")
        .trim();
      const anchorPattern = /<a\b[^>]*href=["']([^"']*\/offer\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let anchorMatch;
      while ((anchorMatch = anchorPattern.exec(html)) && candidates.size < maxOffers) {
        const url = new URL(anchorMatch[1], location.href).href;
        const text = stripTags(anchorMatch[2]);
        const match = text.match(pricePattern);
        if (!match) continue;
        const title = text.split(/\s{2,}/)[0].slice(0, 180) || "G2G listing";
        candidates.set(url, {
          title,
          url,
          price: {
            amount: parseAmount(match[1] || match[2]),
            currency: currency(match[0]),
            raw: clean(match[0], 80)
          },
          text,
          extraction: "rendered-html-fallback"
        });
      }
    }

    if (candidates.size === 0) {
      const lines = (document.body?.innerText || "")
        .split(/\\n|\\r/)
        .map(line => clean(line, 180))
        .filter(Boolean);
      const links = Array.from(document.querySelectorAll("a[href]"))
        .map(anchor => ({ text: clean(anchor.innerText, 180), url: anchor.href }))
        .filter(link => link.url && link.text);
      for (let index = 0; index < lines.length && candidates.size < maxOffers; index += 1) {
        const line = lines[index];
        const match = line.match(pricePattern);
        if (!match) continue;
        const nearby = lines.slice(Math.max(0, index - 5), index)
          .filter(value => !/^(price|view|buy|sold|min\\.|instant|new listing)$/i.test(value));
        const title = nearby[nearby.length - 1] || "G2G listing";
        const link = links.find(item => item.text.toLowerCase().includes(title.toLowerCase().slice(0, 24)));
        const key = (link?.url || location.href) + "|" + line;
        if (candidates.has(key)) continue;
        candidates.set(key, {
          title,
          url: link?.url || location.href,
          price: {
            amount: parseAmount(match[1] || match[2]),
            currency: currency(match[0]),
            raw: clean(match[0], 80)
          },
          text: nearby.concat(line).join(" — "),
          extraction: "rendered-text-fallback"
        });
      }
    }

    return {
      source: "g2g",
      url: location.href,
      scrapedAt: new Date().toISOString(),
      offers: [...candidates.values()].slice(0, maxOffers),
      diagnostics: {
        scrolls,
        candidateCount: candidates.size,
        ...(candidates.size ? {} : {
          warning: "No priced listings matched the generic selectors. G2G may have changed its markup or require a region/cookie flow."
        })
      }
    };
  }, { maxOffers, maxScrolls });

  await fs.writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
