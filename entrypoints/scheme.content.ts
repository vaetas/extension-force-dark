import { shouldSkipFrame } from '../src/guards/page-guard';
import {
  isPrintMedia,
  mediaMentionsColorScheme,
  swapColorSchemeMedia,
} from '../src/theme/scheme-media';

/**
 * MAIN-world script: patch matchMedia and accessible CSS media queries
 * before page scripts run. Registered dynamically with runAt document_start.
 */
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_start',
  world: 'MAIN',
  allFrames: true,
  registration: 'runtime',
  main() {
    if (shouldSkipFrame(location)) return;

    const realMatchMedia = window.matchMedia.bind(window);
    const osPrefersDark = realMatchMedia('(prefers-color-scheme: dark)').matches;

    const patchMediaQueryList = (
      mql: MediaQueryList,
      forcedMatches: boolean,
    ): MediaQueryList => {
      const listeners = new Map<
        EventListenerOrEventListenerObject,
        EventListener
      >();

      const proxy = {
        get matches() {
          return forcedMatches;
        },
        get media() {
          return mql.media;
        },
        get onchange() {
          return mql.onchange;
        },
        set onchange(handler: MediaQueryList['onchange']) {
          mql.onchange = handler;
        },
        addListener(listener: (this: MediaQueryList, ev: MediaQueryListEvent) => void) {
          const wrapped = () => {
            listener.call(
              proxy as unknown as MediaQueryList,
              {
                matches: forcedMatches,
                media: mql.media,
              } as MediaQueryListEvent,
            );
          };
          listeners.set(listener as EventListenerOrEventListenerObject, wrapped);
          mql.addListener(wrapped);
        },
        removeListener(listener: (this: MediaQueryList, ev: MediaQueryListEvent) => void) {
          const wrapped = listeners.get(
            listener as EventListenerOrEventListenerObject,
          );
          if (wrapped) {
            mql.removeListener(wrapped);
            listeners.delete(listener as EventListenerOrEventListenerObject);
          } else {
            mql.removeListener(listener);
          }
        },
        addEventListener(
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | AddEventListenerOptions,
        ) {
          if (type !== 'change') {
            mql.addEventListener(type, listener as EventListener, options);
            return;
          }
          const wrapped: EventListener = () => {
            const event = new Event('change') as MediaQueryListEvent;
            Object.defineProperty(event, 'matches', { value: forcedMatches });
            Object.defineProperty(event, 'media', { value: mql.media });
            if (typeof listener === 'function') {
              listener.call(proxy, event);
            } else {
              listener.handleEvent(event);
            }
          };
          listeners.set(listener, wrapped);
          mql.addEventListener('change', wrapped, options);
        },
        removeEventListener(
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | EventListenerOptions,
        ) {
          const wrapped = listeners.get(listener);
          if (wrapped) {
            mql.removeEventListener(type, wrapped, options);
            listeners.delete(listener);
          } else {
            mql.removeEventListener(type, listener as EventListener, options);
          }
        },
        dispatchEvent(event: Event) {
          return mql.dispatchEvent(event);
        },
      };

      return proxy as unknown as MediaQueryList;
    };

    window.matchMedia = ((query: string): MediaQueryList => {
      const mql = realMatchMedia(query);
      if (!/prefers-color-scheme/i.test(query)) {
        return mql;
      }
      const wantsDark = /prefers-color-scheme\s*:\s*dark/i.test(query);
      const wantsLight = /prefers-color-scheme\s*:\s*light/i.test(query);
      if (wantsDark) return patchMediaQueryList(mql, true);
      if (wantsLight) return patchMediaQueryList(mql, false);
      return mql;
    }) as typeof window.matchMedia;

    // Force color-scheme early for light-dark() and form controls.
    const applyRootScheme = () => {
      try {
        document.documentElement.style.setProperty('color-scheme', 'dark');
      } catch {
        // ignore
      }
    };
    applyRootScheme();

    const rewriteSheetMedia = (sheet: CSSStyleSheet) => {
      // Only swap media text when the OS is light. If OS is already dark,
      // swapping would turn the site's dark CSS off.
      if (osPrefersDark) return;

      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        return;
      }

      for (const rule of Array.from(rules)) {
        if (!(rule instanceof CSSMediaRule)) continue;
        const mediaText = rule.media.mediaText;
        if (isPrintMedia(mediaText)) continue;
        if (!mediaMentionsColorScheme(mediaText)) continue;
        const swapped = swapColorSchemeMedia(mediaText);
        if (swapped !== mediaText) {
          try {
            rule.media.mediaText = swapped;
          } catch {
            // Some browsers make mediaText read-only; try delete/append.
            try {
              const length = rule.media.length;
              for (let i = length - 1; i >= 0; i -= 1) {
                rule.media.deleteMedium(rule.media.item(i)!);
              }
              for (const part of swapped.split(',')) {
                rule.media.appendMedium(part.trim());
              }
            } catch {
              // ignore
            }
          }
        }
      }
    };

    const rewriteAllSheets = () => {
      for (const sheet of Array.from(document.styleSheets)) {
        rewriteSheetMedia(sheet);
      }
    };

    const rewriteMediaAttributes = () => {
      if (osPrefersDark) return;
      const nodes = document.querySelectorAll<HTMLElement>(
        'link[media], source[media], style[media], iframe[media]',
      );
      for (const node of nodes) {
        const media = node.getAttribute('media');
        if (!media || isPrintMedia(media) || !mediaMentionsColorScheme(media)) {
          continue;
        }
        const swapped = swapColorSchemeMedia(media);
        if (swapped !== media) {
          node.setAttribute('media', swapped);
        }
      }
    };

    const boot = () => {
      rewriteAllSheets();
      rewriteMediaAttributes();
    };

    if (document.documentElement) {
      boot();
    }

    const observer = new MutationObserver(() => {
      rewriteAllSheets();
      rewriteMediaAttributes();
      applyRootScheme();
    });

    const startObserver = () => {
      if (!document.documentElement) return;
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['media'],
      });
      boot();
    };

    if (document.documentElement) {
      startObserver();
    } else {
      const htmlObserver = new MutationObserver(() => {
        if (document.documentElement) {
          htmlObserver.disconnect();
          startObserver();
        }
      });
      htmlObserver.observe(document, { childList: true });
    }
  },
});
