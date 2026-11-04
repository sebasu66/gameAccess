/**
 * Saves what Steam's own search returns for each search in searches.json (steam/<id>.json), so a regression run can
 * compare against it without asking Steam again. Run it by hand when the saved answers are too old:
 * `node regress/fetch-steam.mjs [id…]`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const searches = JSON.parse(readFileSync(join(HERE, "searches.json"), "utf8"));
const wanted = new Set(process.argv.slice(2));
const PAGE = 100;

const decode = text => text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** One result row of Steam's search page: app, name, release text and the review tooltip. */
export function parseRows(html) {
  const rows = [];
  for (const match of html.matchAll(/<a [^>]*data-ds-appid="(\d+)"[\s\S]*?<\/a>/g)) {
    const row = match[0];
    const name = decode(/<span class="title">([^<]*)<\/span>/.exec(row)?.[1] ?? "");
    const released = /class="search_released[^"]*">\s*([^<]*?)\s*<\/div>/.exec(row)?.[1] || null;
    const tooltip = decode(/data-tooltip-html="([^"]*)"/.exec(row)?.[1] ?? "");
    const review = /(\d+)% of the ([\d,]+) user reviews/.exec(tooltip);
    rows.push({
      app_id: Number(match[1]), name, released,
      score: review ? Number(review[1]) : null, reviews: review ? Number(review[2].replace(/,/g, "")) : null,
    });
  }
  return rows;
}

/** Steam answers 429 when asked too fast: wait and ask again. */
async function steamPage(url) {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, { headers: { "Accept-Language": "en" } });
    if (response.ok) return response.json();
    if (response.status !== 429 || attempt === 8) throw new Error(`Steam answered ${response.status} for ${url}`);
    await new Promise(done => setTimeout(done, 30000 * attempt));
  }
}

async function fetchAll(steam) {
  const games = [];
  for (let start = 0; ; start += PAGE) {
    const url = new URL("https://store.steampowered.com/search/results/");
    const query = { query: "", start, count: PAGE, infinite: 1, l: "english", cc: "us",
      tags: steam.tags.join(","), category3: (steam.category3 ?? []).join(",") };
    for (const [key, value] of Object.entries(query)) if (value !== "") url.searchParams.set(key, String(value));
    const answer = await steamPage(url);
    const rows = parseRows(answer.results_html ?? "");
    games.push(...rows);
    if (!rows.length || games.length >= answer.total_count) return { total: answer.total_count, games };
    await new Promise(done => setTimeout(done, 3000));
  }
}

for (const search of searches) {
  if (wanted.size && !wanted.has(search.id)) continue;
  const { total, games } = await fetchAll(search.steam);
  writeFileSync(join(HERE, "steam", `${search.id}.json`), `${JSON.stringify({ id: search.id, steam: search.steam, fetched: new Date().toISOString(), total, games }, null, 1)}\n`);
  console.log(search.id, total, "games,", games.filter(game => game.score !== null).length, "with a score");
}
