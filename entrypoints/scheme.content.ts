import { shouldSkipFrame } from '../src/guards/page-guard';
import {
  forceDarkColorSchemeMedia,
  isPrintMedia,
  mediaMentionsColorScheme,
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

    const flagHost = window as Window & { __forceDarkScheme?: boolean };
    if (flagHost.__forceDarkScheme) return;
    flagHost.__forceDarkScheme = true;

    const realMatchMedia = window.matchMedia.bind(window);

    const patchMediaQueryList = (
      mql: MediaQueryList,
      forcedMatches: boolean,
      mediaLabel: string,
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
          return mediaLabel;
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
      if (!mediaMentionsColorScheme(query) || isPrintMedia(query)) {
        return realMatchMedia(query);
      }
      const forced = realMatchMedia(forceDarkColorSchemeMedia(query));
      return patchMediaQueryList(forced, forced.matches, query);
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

    const rewriteRuleList = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSMediaRule) {
          const mediaText = rule.media.mediaText;
          const forced = forceDarkColorSchemeMedia(mediaText);
          if (forced !== mediaText) {
            try {
              rule.media.mediaText = forced;
            } catch {
              try {
                const length = rule.media.length;
                for (let i = length - 1; i >= 0; i -= 1) {
                  rule.media.deleteMedium(rule.media.item(i)!);
                }
                for (const part of forced.split(',')) {
                  const medium = part.trim();
                  if (medium) rule.media.appendMedium(medium);
                }
              } catch {
                // ignore
              }
            }
          }
        }

        if ('cssRules' in rule && rule.cssRules) {
          try {
            rewriteRuleList(rule.cssRules as CSSRuleList);
          } catch {
            // ignore nested rules we cannot read
          }
        }
      }
    };

    let rewriteDepth = 0;
    const rewriteSheetMedia = (sheet: CSSStyleSheet) => {
      if (rewriteDepth > 0) return;
      rewriteDepth += 1;
      try {
        rewriteRuleList(sheet.cssRules);
      } catch {
        // Cross-origin sheets are unreadable.
      } finally {
        rewriteDepth -= 1;
      }
    };

    const rewriteAllSheets = () => {
      for (const sheet of Array.from(document.styleSheets)) {
        rewriteSheetMedia(sheet);
      }
      const adopted = document.adoptedStyleSheets;
      if (adopted) {
        for (const sheet of adopted) rewriteSheetMedia(sheet);
      }
    };

    const rewriteMediaAttributes = () => {
      const nodes = document.querySelectorAll<HTMLElement>(
        'link[media], source[media], style[media], iframe[media]',
      );
      for (const node of nodes) {
        const media = node.getAttribute('media');
        if (!media) continue;
        const forced = forceDarkColorSchemeMedia(media);
        if (forced !== media) node.setAttribute('media', forced);
      }
    };

    const boot = () => {
      rewriteAllSheets();
      rewriteMediaAttributes();
    };

    if (document.documentElement) {
      boot();
    }
    document.addEventListener('DOMContentLoaded', boot, { once: true });
    window.addEventListener('load', boot, { once: true });
    document.addEventListener(
      'load',
      (event) => {
        if (event.target instanceof HTMLLinkElement) boot();
      },
      true,
    );

    let rewriteScheduled = false;
    const scheduleRewrite = () => {
      if (rewriteScheduled) return;
      rewriteScheduled = true;
      requestAnimationFrame(() => {
        rewriteScheduled = false;
        boot();
      });
    };

    try {
      const originalInsertRule = CSSStyleSheet.prototype.insertRule;
      CSSStyleSheet.prototype.insertRule = function (
        rule: string,
        index?: number,
      ) {
        const result = originalInsertRule.call(this, rule, index);
        rewriteSheetMedia(this);
        return result;
      };
    } catch {
      // Some pages lock the stylesheet prototype.
    }

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          scheduleRewrite();
          applyRootScheme();
          return;
        }
        for (const node of Array.from(mutation.addedNodes)) {
          if (!(node instanceof Element)) continue;
          if (
            node.matches('style, link, source, iframe') ||
            node.querySelector('style, link, source, iframe')
          ) {
            scheduleRewrite();
            applyRootScheme();
            return;
          }
        }
      }
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
