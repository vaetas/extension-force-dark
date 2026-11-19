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

    const run = async () => {
      if (running || ctx.isInvalid) return;
      running = true;
      try {
        revertThemePipeline(page);
        const result = await applyThemePipeline(page);
        if (page.isTopFrame) {
          await reportStatus(result.status);
        }
      } catch (error) {
        console.warn('[ForceDark] theme pipeline failed', error);
        if (page.isTopFrame) {
          await reportStatus('idle');
        }
      } finally {
        running = false;
      }
    };

    void run();

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
    });
  } catch {
    // Extension context may be gone.
  }
}
