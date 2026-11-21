import { shouldSkipFrame } from '../src/guards/page-guard';
import {
  SCHEME_ATTR,
  SCHEME_READY_ATTR,
} from '../src/theme/css-utils';
import {
  forceDarkColorSchemeMedia,
  isPrintMedia,
  mediaMentionsColorScheme,
} from '../src/theme/scheme-media';

/**
 * MAIN-world script. Makes the page believe the system prefers dark while the
 * `data-force-dark-scheme="on"` attribute is present on <html>, and undoes
 * everything when the isolated-world script removes it. Registered for
 * "auto" sites at document_start, or injected on demand.
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
    const isOn = (): boolean =>
      document.documentElement?.getAttribute(SCHEME_ATTR) === 'on';

    // ---- matchMedia -------------------------------------------------------
    const patchMediaQueryList = (
      real: MediaQueryList,
      forced: MediaQueryList,
      label: string,
    ): MediaQueryList => {
      const listeners = new Map<
        EventListenerOrEventListenerObject,
        EventListener
      >();
      const matches = (): boolean => (isOn() ? forced.matches : real.matches);

      const proxy = {
        get matches() {
          return matches();
        },
        get media() {
          return label;
        },
        get onchange() {
          return real.onchange;
        },
        set onchange(handler: MediaQueryList['onchange']) {
          real.onchange = handler;
        },
        addListener(listener: (this: MediaQueryList, ev: MediaQueryListEvent) => void) {
          this.addEventListener('change', listener as EventListener);
        },
        removeListener(listener: (this: MediaQueryList, ev: MediaQueryListEvent) => void) {
          this.removeEventListener('change', listener as EventListener);
        },
        addEventListener(
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | AddEventListenerOptions,
        ) {
          if (type !== 'change') {
            real.addEventListener(type, listener as EventListener, options);
            return;
          }
          const wrapped: EventListener = () => {
            const event = new Event('change') as MediaQueryListEvent;
            Object.defineProperty(event, 'matches', { value: matches() });
            Object.defineProperty(event, 'media', { value: label });
            if (typeof listener === 'function') listener.call(proxy, event);
            else listener.handleEvent(event);
          };
          listeners.set(listener, wrapped);
          real.addEventListener('change', wrapped, options);
        },
        removeEventListener(
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | EventListenerOptions,
        ) {
          const wrapped = type === 'change' ? listeners.get(listener) : undefined;
          if (wrapped) {
            real.removeEventListener('change', wrapped, options);
            listeners.delete(listener);
          } else {
            real.removeEventListener(type, listener as EventListener, options);
          }
        },
        dispatchEvent(event: Event) {
          return real.dispatchEvent(event);
        },
      };
      return proxy as unknown as MediaQueryList;
    };

    window.matchMedia = ((query: string): MediaQueryList => {
      const real = realMatchMedia(query);
      if (!mediaMentionsColorScheme(query) || isPrintMedia(query)) return real;
      const forced = realMatchMedia(forceDarkColorSchemeMedia(query));
      return patchMediaQueryList(real, forced, query);
    }) as typeof window.matchMedia;

    // ---- CSSOM @media rewriting (reversible) ------------------------------
    const originalMedia = new Map<CSSMediaRule, string>();
    const originalAttr = new Map<Element, string>();
    let setColorScheme = false;

    const rewriteRuleList = (rules: CSSRuleList): void => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSMediaRule) {
          const text = rule.media.mediaText;
          const forced = forceDarkColorSchemeMedia(text);
          if (forced !== text) {
            if (!originalMedia.has(rule)) originalMedia.set(rule, text);
            try {
              rule.media.mediaText = forced;
            } catch {
              // ignore
            }
          }
        }
        if ('cssRules' in rule && rule.cssRules) {
          try {
            rewriteRuleList(rule.cssRules as CSSRuleList);
          } catch {
            // ignore
          }
        }
      }
    };

    let rewriting = false;
    const rewriteSheet = (sheet: CSSStyleSheet): void => {
      if (rewriting) return;
      rewriting = true;
      try {
        rewriteRuleList(sheet.cssRules);
      } catch {
        // Cross-origin sheets are unreadable.
      } finally {
        rewriting = false;
      }
    };

    const rewriteAll = (): void => {
      if (!isOn()) return;
      for (const sheet of Array.from(document.styleSheets)) rewriteSheet(sheet);
      for (const sheet of document.adoptedStyleSheets ?? []) rewriteSheet(sheet);
      for (const node of document.querySelectorAll<HTMLElement>(
        'link[media], source[media], style[media]',
      )) {
        const media = node.getAttribute('media');
        if (!media) continue;
        const forced = forceDarkColorSchemeMedia(media);
        if (forced !== media) {
          if (!originalAttr.has(node)) originalAttr.set(node, media);
          node.setAttribute('media', forced);
        }
      }
    };

    const engage = (): void => {
      try {
        const style = document.documentElement.style;
        if (!style.getPropertyValue('color-scheme')) {
          style.setProperty('color-scheme', 'dark');
          setColorScheme = true;
        }
      } catch {
        // ignore
      }
      rewriteAll();
    };

    const disengage = (): void => {
      for (const [rule, text] of originalMedia) {
        try {
          rule.media.mediaText = text;
        } catch {
          // ignore
        }
      }
      originalMedia.clear();
      for (const [node, media] of originalAttr) node.setAttribute('media', media);
      originalAttr.clear();
      if (setColorScheme) {
        document.documentElement.style.removeProperty('color-scheme');
        setColorScheme = false;
      }
    };

    try {
      const originalInsertRule = CSSStyleSheet.prototype.insertRule;
      CSSStyleSheet.prototype.insertRule = function (rule: string, index?: number) {
        const result = originalInsertRule.call(this, rule, index);
        if (isOn()) rewriteSheet(this);
        return result;
      };
    } catch {
      // Some pages lock the stylesheet prototype.
    }

    let scheduled = false;
    const schedule = (): void => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        rewriteAll();
      });
    };

    let wasOn = false;
    const observer = new MutationObserver((mutations) => {
      const on = isOn();
      if (on !== wasOn) {
        wasOn = on;
        if (on) engage();
        else disengage();
        return;
      }
      if (!on) return;
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          if (mutation.attributeName === 'media') schedule();
          continue;
        }
        for (const node of Array.from(mutation.addedNodes)) {
          if (
            node instanceof Element &&
            (node.matches('style, link') || node.querySelector('style, link'))
          ) {
            schedule();
            return;
          }
        }
      }
    });

    const start = (): void => {
      const root = document.documentElement;
      if (!root) return;
      // A script registered for this host means "on" until told otherwise.
      if (!root.hasAttribute(SCHEME_ATTR)) root.setAttribute(SCHEME_ATTR, 'on');
      root.setAttribute(SCHEME_READY_ATTR, '1');
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [SCHEME_ATTR, 'media'],
      });
      wasOn = isOn();
      if (wasOn) engage();
      document.addEventListener('DOMContentLoaded', rewriteAll, { once: true });
      window.addEventListener('load', rewriteAll, { once: true });
      document.addEventListener(
        'load',
        (event) => {
          if (event.target instanceof HTMLLinkElement) rewriteAll();
        },
        true,
      );
    };

    if (document.documentElement) {
      start();
    } else {
      const htmlObserver = new MutationObserver(() => {
        if (document.documentElement) {
          htmlObserver.disconnect();
          start();
        }
      });
      htmlObserver.observe(document, { childList: true });
    }
  },
});
