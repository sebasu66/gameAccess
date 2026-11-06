/**
 * The colours of a cover, without the picture: the background is painted as a soft gradient from them, so busy,
 * colourful covers stay subtle behind the catalog.
 */
export type Rgb = [number, number, number];

const saturation = ([r, g, b]: Rgb) => { const max = Math.max(r, g, b), min = Math.min(r, g, b); return max ? (max - min) / max : 0; };
const distance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Up to `count` representative colours from RGBA pixels: colours are grouped in coarse buckets, near-black and
 * near-white pixels are left out, buckets are ranked by how common and how vivid they are, and colours too close to
 * one already chosen are skipped.
 */
export function paletteFromPixels(data: ArrayLike<number>, count = 3): Rgb[] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (data[i + 3] < 128) continue;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max < 28 || min > 235) continue;
    const key = (r >> 5) << 6 | (g >> 5) << 3 | (b >> 5);
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n++; bucket.r += r; bucket.g += g; bucket.b += b;
    buckets.set(key, bucket);
  }
  const ranked = [...buckets.values()]
    .map(bucket => ({ n: bucket.n, rgb: [bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n].map(Math.round) as Rgb }))
    .sort((a, b) => b.n * (0.35 + saturation(b.rgb)) - a.n * (0.35 + saturation(a.rgb)));
  const chosen: Rgb[] = [];
  for (const { rgb } of ranked) {
    if (chosen.every(other => distance(other, rgb) > 60)) chosen.push(rgb);
    if (chosen.length === count) break;
  }
  return chosen;
}

/** A calm version of a colour for the background: never brighter than a mid tone. */
export function calm([r, g, b]: Rgb, ceiling = 150): Rgb {
  const max = Math.max(r, g, b, 1);
  const k = max > ceiling ? ceiling / max : 1;
  return [Math.round(r * k), Math.round(g * k), Math.round(b * k)];
}

/** Paints a soft gradient from the palette: one wide glow per colour on the app's grey. */
export function paintPalette(canvas: HTMLCanvasElement, colors: Rgb[]): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  ctx.fillStyle = "#111416";
  ctx.fillRect(0, 0, w, h);
  const spots: Array<[number, number]> = [[.2, .15], [.8, .25], [.5, .9]];
  colors.forEach((color, index) => {
    const [x, y] = spots[index % spots.length];
    const [r, g, b] = calm(color);
    const glow = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, Math.max(w, h) * .75);
    glow.addColorStop(0, `rgba(${r},${g},${b},.9)`);
    glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  });
}

const cache = new Map<string, Promise<Rgb[]>>();
/** The palette of an image URL. A CORS copy of the image is read (Steam's image server allows it); [] if it cannot. */
export function paletteOf(src: string): Promise<Rgb[]> {
  let found = cache.get(src);
  if (!found) {
    found = new Promise<Rgb[]>(resolve => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.src = src;
      image.decode().then(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 24; canvas.height = 36;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve([]);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(paletteFromPixels(ctx.getImageData(0, 0, canvas.width, canvas.height).data));
      }).catch(() => resolve([]));
    });
    cache.set(src, found);
  }
  return found;
}
