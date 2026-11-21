import { shouldSkipFrame } from '../src/guards/page-guard';
import type { PageThemeStatus } from '../src/storage/settings';
import {
  applyThemePipeline,
  revertThemePipeline,
} from '../src/theme/pipeline';
import type { PageContext } from '../src/theme/types';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_start',
  allFrames: true,
  registration: 'runtime',
  main(ctx) {
    // The background probes this after a settings reload to see whether this
    // navigation actually received the content script.
    (globalThis as Record<string, unknown>)['__forceDarkInjected'] = true;
    document.documentElement?.setAttribute('data-force-dark-injected', '1');

    if (shouldSkipFrame(location)) {
      void reportStatus('blocked');
      return;
    }

    const page: PageContext = {
      origin: location.origin,
      href: location.href,
      isTopFrame: window === window.top,
      document,
    };

    let running = false;
    let lastStatus: PageThemeStatus | null = null;

    const run = async () => {
      if (running || ctx.isInvalid) return;
      running = true;
      try {
        revertThemePipeline(page);
        const result = await applyThemePipeline(page);
        lastStatus = result.status;
        if (page.isTopFrame) {
          await reportStatus(result.status);
        }
      } catch (error) {
        console.warn('[ForceDark] theme pipeline failed', error);
        if (page.isTopFrame) {
          lastStatus = 'idle';
          await reportStatus('idle');
        }
      } finally {
        running = false;
      }
    };

    void run();

    // Hydrating sites fetch and swap styles long after the first pass. If no
    // strategy claimed the page, retry after load and on a short backoff so
    // late-arriving styles still get darkened.
    const retryWhenIdle = () => {
      if (lastStatus === 'idle') void run();
    };
    ctx.addEventListener(window, 'load', () => {
      retryWhenIdle();
      window.setTimeout(retryWhenIdle, 1500);
      window.setTimeout(retryWhenIdle, 4000);
    });

    ctx.addEventListener(window, 'pageshow', (event) => {
      if ((event as PageTransitionEvent).persisted) {
        void run();
      }
    });
  },
});

async function reportStatus(status: PageThemeStatus): Promise<void> {
  try {
    await browser.runtime.sendMessage({
      type: 'REPORT_THEME_STATUS',
      status,
      origin: location.origin,
      timeOrigin: performance.timeOrigin,
    });
  } catch {
    // Extension context may be gone.
  }
}
