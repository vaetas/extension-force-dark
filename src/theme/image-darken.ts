import type { SampleImageResponse } from '../messaging/protocol';
import { classifyImagePixels, SAMPLE_SIZE, type ImageVerdict } from './image-classify';
import { ROOT_SCHEME_ATTR } from './css-utils';

export const IMAGE_ATTR = 'data-force-dark-img';
export const IMAGE_STYLE_ID = 'force-dark-images';

/** Gated on the root attribute, so it is inert as soon as recolor is reverted. */
const IMAGE_CSS = `
html[${ROOT_SCHEME_ATTR}] img[${IMAGE_ATTR}="bg"] { filter: invert(1) hue-rotate(180deg) !important; mix-blend-mode: screen !important; }
html[${ROOT_SCHEME_ATTR}] img[${IMAGE_ATTR}="ink"] { filter: invert(1) hue-rotate(180deg) !important; }
`;

const MAX_DIMENSION = 1600;
const MIN_DIMENSION = 8;
const CONCURRENCY = 3;
const MAX_CACHED_VERDICTS = 500;

function sampleLocally(img: HTMLImageElement): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  // Throws SecurityError for images the page may not read (cross-origin).
  return ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
}

async function sampleViaBackground(url: string): Promise<number[] | null> {
  if (!/^https?:/i.test(url)) return null;
  try {
    const response = (await browser.runtime.sendMessage({
      type: 'SAMPLE_IMAGE',
      url,
    })) as SampleImageResponse | undefined;
    return response?.ok ? response.pixels : null;
  } catch {
    return null;
  }
}

/**
 * Opt-in: inverts <img> elements that have a light background (or dark ink on
 * transparency) so they don't glare on a recolored page. Anything it can't
 * read or isn't sure about is left exactly as the site made it.
 */
export function createImageDarkener() {
  const verdicts = new Map<string, ImageVerdict>();
  let evaluated = new WeakMap<HTMLImageElement, string>();
  let running = false;
  let token = 0;
  let intersection: IntersectionObserver | null = null;
  let mutations: MutationObserver | null = null;
  let loadListener: ((event: Event) => void) | null = null;
  let doc: Document | null = null;
  const queue: Array<() => Promise<void>> = [];
  let active = 0;

  const pump = (): void => {
    while (active < CONCURRENCY && queue.length > 0) {
      const job = queue.shift()!;
      active += 1;
      void job().finally(() => {
        active -= 1;
        pump();
      });
    }
  };

  const verdictFor = async (img: HTMLImageElement, url: string): Promise<ImageVerdict> => {
    const cached = verdicts.get(url);
    if (cached) return cached;

    let pixels: ArrayLike<number> | null = null;
    try {
      pixels = sampleLocally(img);
    } catch {
      pixels = await sampleViaBackground(url);
    }
    const verdict = pixels ? classifyImagePixels(pixels) : 'skip';
    verdicts.set(url, verdict);
    if (verdicts.size > MAX_CACHED_VERDICTS) {
      const first = verdicts.keys().next().value;
      if (first) verdicts.delete(first);
    }
    return verdict;
  };

  const process = async (img: HTMLImageElement, mine: number): Promise<void> => {
    const url = img.currentSrc || img.src;
    if (!url || !img.complete) return; // `load` will bring it back
    const { naturalWidth: w, naturalHeight: h } = img;
    if (!w || !h) return;
    if (evaluated.get(img) === url) return;
    evaluated.set(img, url);

    let verdict: ImageVerdict = 'skip';
    if (w >= MIN_DIMENSION && h >= MIN_DIMENSION && w <= MAX_DIMENSION && h <= MAX_DIMENSION) {
      verdict = await verdictFor(img, url);
    }
    if (mine !== token || !running) return;
    if (verdict === 'skip') img.removeAttribute(IMAGE_ATTR);
    else img.setAttribute(IMAGE_ATTR, verdict);
  };

  const watch = (img: HTMLImageElement): void => {
    intersection?.observe(img);
  };

  const scan = (root: ParentNode): void => {
    if (root instanceof HTMLImageElement) watch(root);
    for (const img of root.querySelectorAll('img')) watch(img);
  };

  return {
    start(page: Document): void {
      if (running) return;
      running = true;
      evaluated = new WeakMap(); // attributes were cleared by the last stop()
      doc = page;
      const mine = ++token;

      const style = page.createElement('style');
      style.id = IMAGE_STYLE_ID;
      style.textContent = IMAGE_CSS;
      page.documentElement.appendChild(style);

      intersection = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const img = entry.target as HTMLImageElement;
            intersection?.unobserve(img);
            queue.push(() => process(img, mine));
          }
          pump();
        },
        { rootMargin: '300px' },
      );

      mutations = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === 'attributes') {
            const img = record.target;
            if (img instanceof HTMLImageElement) {
              evaluated.delete(img);
              img.removeAttribute(IMAGE_ATTR);
              watch(img);
            }
            continue;
          }
          for (const node of Array.from(record.addedNodes)) {
            if (node instanceof Element) scan(node);
          }
        }
      });
      mutations.observe(page.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'srcset'],
      });

      // Lazy images finish loading long after they were added.
      loadListener = (event: Event) => {
        if (event.target instanceof HTMLImageElement) watch(event.target);
      };
      page.addEventListener('load', loadListener, true);

      scan(page);
    },

    stop(): void {
      if (!running) return;
      running = false;
      token += 1;
      intersection?.disconnect();
      mutations?.disconnect();
      intersection = null;
      mutations = null;
      queue.length = 0;
      if (doc && loadListener) doc.removeEventListener('load', loadListener, true);
      loadListener = null;
      doc?.getElementById(IMAGE_STYLE_ID)?.remove();
      for (const img of doc?.querySelectorAll(`img[${IMAGE_ATTR}]`) ?? []) {
        img.removeAttribute(IMAGE_ATTR);
      }
      doc = null;
    },
  };
}
