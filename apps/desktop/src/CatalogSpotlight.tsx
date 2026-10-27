import { useEffect, useRef, useState } from "react";
import { gsap, motionOk, SplitText, useGSAP } from "./motion/gsap";
import { cachedSpotlight, onSpotlightChanged, prefetchSpotlight, type Slide } from "./spotlightSlides";
import { useI18n } from "./i18n";
import { GaButton } from "./components/ga/Buttons";
import type { CatalogGame } from "./types";

const ROTATE_MS = 7000;

/** Days since release, or null when the date is unknown or in the future. */
export function daysSinceRelease(date: string | null | undefined, now = Date.now()): number | null {
  const time = date ? Date.parse(date) : NaN;
  if (!Number.isFinite(time) || time > now) return null;
  return Math.floor((now - time) / 86400000);
}

/**
 * Banner at the top of the catalog: the games that came out on Steam these days, one at a time. The slides (game and a
 * wide image that really loads) are fetched early (spotlightSlides.ts), so the banner is complete when the catalog
 * appears. The visible layer is never replaced (no flicker); the title enters letter by letter.
 */
export default function CatalogSpotlight({ exclude, onOpen }: { exclude: (game: CatalogGame) => boolean; onOpen: (game: CatalogGame) => void }) {
  const { t } = useI18n();
  const pick = (all: Slide[] | null) => (all ?? []).filter(slide => !exclude(slide.game)).slice(0, 5);
  const [slides, setSlides] = useState<Slide[]>(() => pick(cachedSpotlight()));
  const [index, setIndex] = useState(0);
  const [layers, setLayers] = useState<[string, string]>(() => [slides[0]?.url ?? "", ""]);
  const [front, setFront] = useState(0);
  const root = useRef<HTMLElement>(null);
  const excludeRef = useRef(exclude);
  excludeRef.current = exclude;

  useEffect(() => {
    let alive = true;
    const choose = (all: Slide[]) => {
      if (!alive) return;
      const chosen = all.filter(slide => !excludeRef.current(slide.game)).slice(0, 5);
      setSlides(chosen);
      setIndex(0);
      if (chosen[0]) { setLayers([chosen[0].url, ""]); setFront(0); }
    };
    if (!slides.length) void prefetchSpotlight().then(choose);
    // New games in the catalog (its daily update): the banner shows them without reopening the app.
    const stop = onSpotlightChanged(() => choose(cachedSpotlight() ?? []));
    return () => { alive = false; stop(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const slide = slides[index % Math.max(1, slides.length)];
  const game = slide?.game;
  // Rotation: the next image (already decoded) goes on the hidden layer, then the layers swap.
  useEffect(() => {
    if (!slide || layers[front] === slide.url) return;
    const next = front ? 0 : 1;
    setLayers(current => (next ? [current[0], slide.url] : [slide.url, current[1]]));
    setFront(next);
  }, [slide?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (slides.length < 2) return;
    const timer = window.setTimeout(() => setIndex(value => (value + 1) % slides.length), ROTATE_MS);
    return () => window.clearTimeout(timer);
  }, [index, slides.length]);

  useGSAP(() => {
    if (!root.current || !motionOk() || !game) return;
    const title = root.current.querySelector(".ga-spotlight-title");
    if (!title) return;
    const split = new SplitText(title, { type: "chars", mask: "chars" });
    gsap.from(split.chars, { yPercent: 110, duration: .8, ease: "expo.out", stagger: .025 });
    gsap.fromTo(root.current.querySelectorAll(".ga-spotlight-eyebrow, .ga-spotlight-actions"), { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: .6, stagger: .08, delay: .12, ease: "power3.out" });
    return () => split.revert();
  }, { dependencies: [game?.id], scope: root });

  if (!game) return null;
  const days = daysSinceRelease(game.release_date);
  const eyebrow = days === null ? t("spotlightNew") : days === 0 ? t("spotlightToday") : days === 1 ? t("spotlightOneDay") : t("spotlightDays", { days });
  return (
    <section ref={root} className="ga-spotlight" aria-label={t("spotlightLabel")}>
      {layers.map((url, layer) => url ? <img key={layer} className="ga-spotlight-image" data-front={layer === front || undefined} src={url} alt="" /> : null)}
      <div className="ga-spotlight-content">
        <span className="ga-spotlight-eyebrow">{eyebrow}{game.genres?.length ? ` · ${game.genres.slice(0, 2).join(" · ")}` : ""}</span>
        <h2 className="ga-spotlight-title" key={game.id}>{game.name}</h2>
        <div className="ga-spotlight-actions"><GaButton variant="primary" onClick={() => onOpen(game)}>{t("spotlightOpen")}</GaButton></div>
      </div>
      {slides.length > 1 ? (
        <div className="ga-spotlight-dots">
          {slides.map(({ game: item }, dot) => <button key={item.id} type="button" className="ga-spotlight-dot" data-active={dot === index % slides.length || undefined} aria-label={item.name} title={item.name} onClick={() => setIndex(dot)}><i style={dot === index % slides.length ? { animationDuration: `${ROTATE_MS}ms` } : undefined} /></button>)}
        </div>
      ) : null}
    </section>
  );
}
