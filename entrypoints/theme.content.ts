import { shouldSkipFrame } from '../src/guards/page-guard';
import {
  darkenImagesFor,
  isSiteMode,
  loadSettings,
  modeFor,
  normalizeSettings,
  SETTINGS_STORAGE_KEY,
  type PageThemeStatus,
} from '../src/storage/settings';
import { createImageDarkener } from '../src/theme/image-darken';
import { createController } from '../src/theme/pipeline';
import type { PageContext } from '../src/theme/types';

/** Iframes follow the host of the tab they are embedded in. */
function resolveHost(): string {
  if (window === window.top) return location.hostname;
  const ancestors = location.ancestorOrigins;
  if (ancestors && ancestors.length > 0) {
    try {
      return new URL(ancestors[ancestors.length - 1]).hostname;
    } catch {
      // fall through
    }
  }
  return location.hostname;
}

function whenRootExists(doc: Document, cb: () => void): void {
  if (doc.documentElement) {
    cb();
    return;
  }
  const observer = new MutationObserver(() => {
    if (doc.documentElement) {
      observer.disconnect();
      cb();
    }
  });
  observer.observe(doc, { childList: true });
}

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_start',
  allFrames: true,
  main(ctx) {
    if (shouldSkipFrame(location)) return;

    const isTopFrame = window === window.top;
    const host = resolveHost();
    const page: PageContext = {
      origin: location.origin,
      href: location.href,
      isTopFrame,
      document,
    };

    // Opt-in image inversion; only meaningful while the page is recolored.
    const images = createImageDarkener();
    let imagesWanted = false;
    let lastStatus: PageThemeStatus = 'pending';
    const syncImages = (): void => {
      if (imagesWanted && lastStatus === 'recolor' && document.documentElement) {
        images.start(document);
      } else {
        images.stop();
      }
    };

    const report = (status: PageThemeStatus): void => {
      if (!isTopFrame || ctx.isInvalid) return;
      void browser.runtime
        .sendMessage({
          type: 'REPORT_THEME_STATUS',
          status,
          host,
          timeOrigin: performance.timeOrigin,
        })
        .catch(() => {
          // Extension context may be gone.
        });
    };

    const controller = createController(page, (status) => {
      lastStatus = status;
      syncImages();
      report(status);
    });

    whenRootExists(document, () => {
      void loadSettings()
        .then((settings) => {
          if (ctx.isInvalid) return;
          imagesWanted = darkenImagesFor(settings, host);
          return controller.set(modeFor(settings, host));
        })
        .catch((error) => console.warn('[ForceDark] load failed', error));
    });

    const onChanged = (
      changes: Record<string, { newValue?: unknown }>,
      area: string,
    ): void => {
      if (area !== 'local' || ctx.isInvalid) return;
      const change = changes[SETTINGS_STORAGE_KEY];
      if (!change) return;
      const settings = normalizeSettings(change.newValue);
      const mode = modeFor(settings, host);
      imagesWanted = darkenImagesFor(settings, host);
      syncImages();
      if (isSiteMode(mode) && document.documentElement) {
        void controller.set(mode);
      }
    };
    browser.storage.onChanged.addListener(onChanged);

    // Back/forward cache restores skip document_start; make sure we're live.
    ctx.addEventListener(window, 'pageshow', (event) => {
      if (!(event as PageTransitionEvent).persisted) return;
      void loadSettings().then((settings) => {
        imagesWanted = darkenImagesFor(settings, host);
        void controller.set(modeFor(settings, host));
      });
    });
  },
});
