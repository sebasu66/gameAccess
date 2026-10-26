/**
 * Game detail open/close (docs/TAREA-interfaz-nueva.md T9). Opening: the dialog is clipped to the card's rectangle
 * and the clip opens to the full panel; a copy of the cover travels only to the top strip while it fades downward,
 * and the detail's parts come in on top. Closing: the parts fold, the clip returns to the card, and only then the
 * card's cover comes back as a grid of small squares filling from the centre outward (1.2 s). The cover is never
 * shown enlarged.
 */
import { gsap, motionOk } from "./gsap";
import "./detail-morph.css";

const clipFor = (r: { x: number; y: number; w: number; h: number }, W: number, H: number, radius = 8) =>
  `inset(${r.y}px ${W - r.x - r.w}px ${H - r.y - r.h}px ${r.x}px round ${radius}px)`;

function relativeRect(source: HTMLElement, dialog: HTMLElement) {
  const d = dialog.getBoundingClientRect(), s = source.getBoundingClientRect();
  if (!s.width || !s.height) return { x: d.width * .3, y: d.height * .3, w: d.width * .4, h: d.height * .4, W: d.width, H: d.height };
  return { x: s.left - d.left, y: s.top - d.top, w: s.width, h: s.height, W: d.width, H: d.height };
}

export function coverImage(source: HTMLElement): HTMLImageElement | null {
  return [...source.querySelectorAll("img")].find(img => getComputedStyle(img).opacity !== "0" && img.naturalWidth > 0) ?? null;
}

function parts(dialog: HTMLElement): Element[] {
  return [...dialog.querySelectorAll(".ga-game-detail > *, .ga-detail-close, .ga-detail-more")];
}

/** Grows the dialog out of the card. Returns a cleanup that stops the animation. */
export function morphOpen(dialog: HTMLElement, source: HTMLElement): () => void {
  if (!motionOk()) return () => undefined;
  const r = relativeRect(source, dialog);
  const strip = Math.min(230, r.H * .3);
  const image = coverImage(source);
  const ghost = image ? Object.assign(document.createElement("img"), { src: image.currentSrc || image.src, alt: "", className: "ga-detail-ghost" }) : null;
  if (ghost) dialog.append(ghost);
  gsap.set(source, { opacity: 0 });
  const tl = gsap.timeline({ onComplete: () => { ghost?.remove(); gsap.set(dialog, { clearProps: "clipPath" }); } })
    .fromTo(dialog, { clipPath: clipFor(r, r.W, r.H) }, { clipPath: `inset(0px 0px 0px 0px round 12px)`, duration: .8, ease: "expo.inOut" }, 0)
    .fromTo(parts(dialog), { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: .55, stagger: .05, ease: "expo.out" }, .4);
  if (ghost) tl.fromTo(ghost, { left: r.x, top: r.y, width: r.w, height: r.h, opacity: 1, "--m": "100%" }, { left: 0, top: 0, width: r.W, height: strip, "--m": "25%", duration: .8, ease: "expo.inOut" }, 0)
    .to(ghost, { opacity: 0, duration: .45, ease: "power1.out" }, .55);
  return () => { tl.kill(); ghost?.remove(); gsap.set(dialog, { clearProps: "clipPath" }); gsap.set(parts(dialog), { clearProps: "opacity,transform" }); };
}

/** The visible cards around the opened one move outward a little, as if pushed by the growing detail. */
export function pushCards(source: HTMLElement): void {
  if (!motionOk()) return;
  const card = source.closest<HTMLElement>("[data-library-game-id]") ?? source;
  const s = card.getBoundingClientRect(), cx = s.left + s.width / 2, cy = s.top + s.height / 2;
  const reach = Math.hypot(window.innerWidth, window.innerHeight) / 2;
  for (const other of document.querySelectorAll<HTMLElement>("[data-library-game-id]")) {
    if (other === card) continue;
    const r = other.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > window.innerHeight) continue;
    const dx = r.left + r.width / 2 - cx, dy = r.top + r.height / 2 - cy, d = Math.hypot(dx, dy) || 1;
    const force = 34 * Math.max(.25, 1 - d / reach);
    gsap.to(other, { x: dx / d * force, y: dy / d * force, scale: .96, opacity: .55, duration: .7, ease: "expo.out", overwrite: true });
  }
}

/** Puts the pushed cards back. */
export function releaseCards(source?: HTMLElement | null): void {
  const own = source?.closest<HTMLElement>("[data-library-game-id]") ?? source;
  const cards = [...document.querySelectorAll<HTMLElement>("[data-library-game-id]")].filter(card => card !== own);
  if (!motionOk()) { gsap.set(cards, { clearProps: "transform,opacity" }); return; }
  gsap.to(cards, { x: 0, y: 0, scale: 1, opacity: 1, duration: .6, ease: "expo.out", overwrite: true, clearProps: "transform,opacity" });
}

/** Shows the card the detail came from again, unless its cover is coming back as squares (pixelReveal). */
export function restoreSource(source: HTMLElement): void {
  if (source.dataset.revealing) return;
  gsap.set(source, { clearProps: "opacity" });
}

/** Folds the dialog back into the card; resolves when the dialog may unmount. */
export function morphClose(dialog: HTMLElement, source: HTMLElement | null): Promise<void> {
  if (!motionOk() || !source || !source.isConnected) return Promise.resolve();
  gsap.set(source, { opacity: 1 });
  const r = relativeRect(source, dialog);
  gsap.set(source, { opacity: 0 });
  return new Promise(resolve => {
    gsap.timeline({ onComplete: () => { pixelReveal(source); resolve(); } })
      .to([...parts(dialog)].reverse(), { opacity: 0, y: 14, duration: .2, stagger: .025, ease: "power2.in" }, 0)
      .to(dialog, { clipPath: clipFor(r, r.W, r.H), duration: .55, ease: "expo.inOut" }, .15);
  });
}

/**
 * The cover comes back as a grid of small squares (about 1/16 of the side, at least 8 px) filling from the centre
 * outward with some randomness, in 1.2 s. The card is back in its place in the grid and the canvas is its own child,
 * so it moves with the grid (scroll, a panel opening) while it fills; the card's content stays hidden until then.
 */
export function pixelReveal(element: HTMLElement): void {
  const image = coverImage(element);
  const screen = element.getBoundingClientRect();
  // Layout size, not the on-screen box: the canvas lives inside the card and shares its transforms.
  const rect = { width: element.clientWidth, height: element.clientHeight };
  let restorePosition = "";
  const done = () => {
    delete element.dataset.revealing;
    if (restorePosition) element.style.position = restorePosition === "static" ? "" : restorePosition;
    gsap.set(element, { opacity: 1 });
  };
  if (!motionOk() || !image || !rect.width || !rect.height || screen.bottom < 0 || screen.top > window.innerHeight) { done(); return; }
  if (["", "static"].includes(getComputedStyle(element).position)) { restorePosition = element.style.position || "static"; element.style.position = "relative"; }
  element.dataset.revealing = "true";
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = document.createElement("canvas");
  canvas.className = "ga-pixel-reveal";
  canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
  canvas.style.borderRadius = getComputedStyle(element).borderRadius;
  element.append(canvas);
  gsap.set(element, { opacity: 1 });
  const ctx = canvas.getContext("2d");
  if (!ctx) { canvas.remove(); done(); return; }
  const ar = rect.width / rect.height, iar = image.naturalWidth / image.naturalHeight;
  let sw = image.naturalWidth, sh = image.naturalHeight, sx = 0, sy = 0;
  if (iar > ar) { sw = sh * ar; sx = (image.naturalWidth - sw) / 2; } else { sh = sw / ar; sy = (image.naturalHeight - sh) / 2; }
  const size = Math.max(8, Math.round(Math.min(rect.width, rect.height) / 16));
  const cols = Math.ceil(rect.width / size), rows = Math.ceil(rect.height / size);
  const kx = sw / rect.width, ky = sh / rect.height, cx = cols / 2, cy = rows / 2, maxD = Math.hypot(cx, cy);
  const cells: Array<{ x: number; y: number; t: number }> = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) cells.push({ x, y, t: Math.hypot(x + .5 - cx, y + .5 - cy) / maxD * .8 + Math.random() * .2 });
  cells.sort((a, b) => a.t - b.t);
  let drawn = 0;
  const paint = (upto: number) => {
    for (; drawn < upto; drawn++) {
      const cell = cells[drawn], px = cell.x * size, py = cell.y * size, w = Math.min(size, rect.width - px), h = Math.min(size, rect.height - py);
      ctx.drawImage(image, sx + px * kx, sy + py * ky, w * kx, h * ky, px * dpr, py * dpr, w * dpr, h * dpr);
    }
  };
  const progress = { v: 0 };
  gsap.to(progress, { v: 1, duration: 1.2, ease: "power1.inOut", onUpdate: () => paint(Math.floor(progress.v * cells.length)), onComplete: () => { paint(cells.length); done(); canvas.remove(); } });
}
