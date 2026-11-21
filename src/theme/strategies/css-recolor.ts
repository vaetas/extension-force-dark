import type { FetchStylesheetResponse } from '../../messaging/protocol';
import {
  BASE_LAYER_CSS,
  buildOverrideSheet,
  computeVariableRoles,
  declarationsOf,
  EXTENSION_STYLE_ID,
  ROOT_SCHEME_ATTR,
  rewriteDeclarations,
  rewriteValueForRole,
  shouldProcessProperty,
  walkStyleRules,
  type CssOverride,
} from '../css-utils';
import { roleForProperty } from '../color';
import type { PageContext, PageThemeStrategy, StrategyResult } from '../types';

type Scope = Document | ShadowRoot;

const MAX_SHEET_BYTES = 2 * 1024 * 1024;
const sheetCache = new Map<string, string>();
/** Our own override sheets — must never be re-processed as input. */
const ownSheets = new WeakSet<CSSStyleSheet>();

async function fetchCrossOriginCss(url: string): Promise<string | null> {
  const cached = sheetCache.get(url);
  if (cached != null) return cached;
  try {
    const response = (await browser.runtime.sendMessage({
      type: 'FETCH_STYLESHEET',
      url,
    })) as FetchStylesheetResponse;
    if (!response?.ok || response.cssText.length > MAX_SHEET_BYTES) return null;
    sheetCache.set(url, response.cssText);
    if (sheetCache.size > 32) {
      const first = sheetCache.keys().next().value;
      if (first) sheetCache.delete(first);
    }
    return response.cssText;
  } catch {
    return null;
  }
}

async function gatherSheets(scope: Scope): Promise<CSSStyleSheet[]> {
  const sheets: CSSStyleSheet[] = [];
  for (const sheet of Array.from(scope.styleSheets)) {
    try {
      void sheet.cssRules; // throws for cross-origin sheets
      sheets.push(sheet);
    } catch {
      if (!sheet.href) continue;
      const cssText = await fetchCrossOriginCss(sheet.href);
      if (!cssText) continue;
      try {
        const constructed = new CSSStyleSheet();
        await constructed.replace(cssText);
        sheets.push(constructed);
      } catch {
        // Unparsable sheet.
      }
    }
  }
  for (const sheet of scope.adoptedStyleSheets ?? []) {
    if (!ownSheets.has(sheet)) sheets.push(sheet);
  }
  return sheets;
}

function safeRules(sheet: CSSStyleSheet): CSSRuleList | null {
  try {
    return sheet.cssRules;
  } catch {
    return null;
  }
}

interface InlineBackup {
  value: string;
  priority: string;
}

export function createCssRecolorStrategy(): PageThemeStrategy {
  let observer: MutationObserver | null = null;
  let loadTarget: Document | null = null;
  let loadListener: ((event: Event) => void) | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = true;
  let refreshing = false;
  let refreshAgain = false;
  let lastSignature = '';

  const overrideSheets = new Map<Scope, CSSStyleSheet>();
  const shadowRoots = new Set<ShadowRoot>();
  /** element -> property -> original inline value (so revert restores it). */
  const inlineBackups = new Map<HTMLElement, Map<string, InlineBackup>>();
  /** What we last wrote inline, so our own mutations don't loop. */
  const written = new WeakMap<HTMLElement, Map<string, string>>();

  /** An adopted sheet placed last outranks every document sheet. */
  const ensureAdopted = (scope: Scope, sheet: CSSStyleSheet): void => {
    const adopted = scope.adoptedStyleSheets ?? [];
    if (adopted[adopted.length - 1] === sheet) return;
    scope.adoptedStyleSheets = [...adopted.filter((s) => s !== sheet), sheet];
  };

  const publish = (doc: Document, scope: Scope, css: string): void => {
    try {
      let sheet = overrideSheets.get(scope);
      if (!sheet) {
        sheet = new CSSStyleSheet();
        overrideSheets.set(scope, sheet);
        ownSheets.add(sheet);
      }
      sheet.replaceSync(css);
      ensureAdopted(scope, sheet);
      doc.getElementById(EXTENSION_STYLE_ID)?.remove();
      return;
    } catch {
      // Constructable sheets unavailable; fall back to a <style>.
    }
    if (scope !== doc) return;
    let el = doc.getElementById(EXTENSION_STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      el = doc.createElement('style');
      el.id = EXTENSION_STYLE_ID;
      (doc.head ?? doc.documentElement).appendChild(el);
    }
    el.textContent = css;
  };

  const signatureOf = (scopes: Scope[]): string => {
    const parts: string[] = [];
    for (const scope of scopes) {
      const own = overrideSheets.get(scope);
      const describe = (sheet: CSSStyleSheet): void => {
        const rules = safeRules(sheet);
        parts.push(`${sheet.href ?? 'inline'}:${rules ? rules.length : -1}`);
      };
      for (const sheet of Array.from(scope.styleSheets)) describe(sheet);
      for (const sheet of scope.adoptedStyleSheets ?? []) {
        if (sheet !== own) describe(sheet);
      }
    }
    return parts.join('|');
  };

  const rewriteInlineElement = (el: HTMLElement): void => {
    const style = el.style;
    for (let i = 0; i < style.length; i += 1) {
      const property = style.item(i);
      if (!shouldProcessProperty(property) || property.startsWith('--')) {
        continue;
      }
      const role = roleForProperty(property);
      if (!role) continue;
      const value = style.getPropertyValue(property);
      if (!value) continue;
      if (written.get(el)?.get(property) === value) continue;
      const rewritten = rewriteValueForRole(value, role);
      if (!rewritten || rewritten === value) continue;

      const priority = style.getPropertyPriority(property);
      let backups = inlineBackups.get(el);
      if (!backups) {
        backups = new Map();
        inlineBackups.set(el, backups);
      }
      backups.set(property, { value, priority });
      style.setProperty(property, rewritten, priority);
      let mine = written.get(el);
      if (!mine) {
        mine = new Map();
        written.set(el, mine);
      }
      mine.set(property, style.getPropertyValue(property));
    }
  };

  const rewriteInlineStyles = (root: ParentNode): void => {
    for (const el of root.querySelectorAll<HTMLElement>('[style]')) {
      rewriteInlineElement(el);
    }
  };

  const findShadowRoots = (doc: Document): ShadowRoot[] => {
    const found: ShadowRoot[] = [];
    const scan = (root: ParentNode): void => {
      for (const el of Array.from(root.querySelectorAll('*'))) {
        if (el.shadowRoot) {
          found.push(el.shadowRoot);
          scan(el.shadowRoot);
        }
      }
    };
    scan(doc);
    return found;
  };

  const applyScope = async (doc: Document, scope: Scope): Promise<void> => {
    const sheets = await gatherSheets(scope);
    const styleRules: Array<{ rule: CSSStyleRule; context: string[] }> = [];
    const decls: Array<{ property: string; value: string }> = [];
    for (const sheet of sheets) {
      const rules = safeRules(sheet);
      if (!rules) continue;
      walkStyleRules(rules, (rule, context) => {
        styleRules.push({ rule, context });
        for (const d of declarationsOf(rule.style)) decls.push(d);
      });
    }
    const variableRoles = computeVariableRoles(decls);

    const overrides: CssOverride[] = [];
    const seen = new Set<string>();
    for (const { rule, context } of styleRules) {
      const selector = rule.selectorText;
      if (!selector) continue;
      for (const d of rewriteDeclarations(
        declarationsOf(rule.style),
        variableRoles,
      )) {
        const key = `${context.join('|')}|${selector}|${d.property}|${d.value}|${d.important}`;
        if (seen.has(key)) continue;
        seen.add(key);
        overrides.push({ ...d, selector, context });
      }
    }

    const base = scope === doc ? `${BASE_LAYER_CSS}\n` : '';
    publish(doc, scope, base + buildOverrideSheet(overrides));
  };

  const refresh = async (doc: Document): Promise<void> => {
    if (stopped) return;
    if (refreshing) {
      refreshAgain = true;
      return;
    }
    refreshing = true;
    try {
      do {
        refreshAgain = false;
        await applyScope(doc, doc);
        for (const shadow of findShadowRoots(doc)) {
          if (stopped) return;
          shadowRoots.add(shadow);
          await applyScope(doc, shadow);
          rewriteInlineStyles(shadow);
        }
        if (stopped) return;
        rewriteInlineStyles(doc);
        lastSignature = signatureOf([doc, ...shadowRoots]);
      } while (refreshAgain && !stopped);
    } catch (error) {
      console.warn('[ForceDark] recolor refresh failed', error);
    } finally {
      refreshing = false;
    }
  };

  return {
    id: 'recolor',

    async apply(page: PageContext): Promise<StrategyResult> {
      const doc = page.document;
      stopped = false;
      doc.documentElement.setAttribute(ROOT_SCHEME_ATTR, 'recolor');

      // Publish the base layer right away; sheets are folded in as they land.
      publish(doc, doc, BASE_LAYER_CSS);

      const schedule = (): void => {
        if (stopped) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          void refresh(doc);
        }, 80);
      };

      loadTarget = doc;
      loadListener = (event: Event) => {
        const target = event.target;
        if (
          target instanceof HTMLLinkElement ||
          target instanceof HTMLStyleElement
        ) {
          schedule();
        }
      };
      doc.addEventListener('load', loadListener, true);

      observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          const target = mutation.target;
          if (mutation.type === 'attributes') {
            if (
              mutation.attributeName === 'style' &&
              target instanceof HTMLElement
            ) {
              rewriteInlineElement(target);
            } else if (
              target instanceof HTMLLinkElement ||
              target instanceof HTMLStyleElement
            ) {
              schedule();
            }
            continue;
          }
          if (target instanceof HTMLStyleElement) schedule();
          for (const node of Array.from(mutation.addedNodes)) {
            if (!(node instanceof Element)) continue;
            if (node.id === EXTENSION_STYLE_ID) continue;
            if (
              node instanceof HTMLStyleElement ||
              node instanceof HTMLLinkElement
            ) {
              schedule();
            } else if (node instanceof HTMLElement) {
              if (node.hasAttribute('style')) rewriteInlineElement(node);
              if (node.firstElementChild) rewriteInlineStyles(node);
              if (node.shadowRoot || node.querySelector('style, link')) {
                schedule();
              }
            }
          }
        }
      });
      observer.observe(doc.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'href', 'media', 'disabled'],
      });

      // Hydration swaps CSSOM rules / adopted sheets without DOM mutations,
      // and pages sometimes overwrite adoptedStyleSheets. Poll cheaply.
      pollTimer = setInterval(() => {
        if (stopped || doc.visibilityState === 'hidden') return;
        const own = overrideSheets.get(doc);
        if (own) ensureAdopted(doc, own);
        const signature = signatureOf([doc, ...shadowRoots]);
        if (signature !== lastSignature) {
          lastSignature = signature;
          schedule();
        }
      }, 750);

      await refresh(doc);
      return 'handled';
    },

    revert(page: PageContext): void {
      stopped = true;
      observer?.disconnect();
      observer = null;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = null;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      if (loadTarget && loadListener) {
        loadTarget.removeEventListener('load', loadListener, true);
      }
      loadTarget = null;
      loadListener = null;

      for (const [scope, sheet] of overrideSheets) {
        try {
          scope.adoptedStyleSheets = (scope.adoptedStyleSheets ?? []).filter(
            (s) => s !== sheet,
          );
        } catch {
          // ignore
        }
      }
      overrideSheets.clear();
      shadowRoots.clear();
      page.document.getElementById(EXTENSION_STYLE_ID)?.remove();

      for (const [el, backups] of inlineBackups) {
        for (const [property, backup] of backups) {
          try {
            el.style.setProperty(property, backup.value, backup.priority);
          } catch {
            // Element may be gone.
          }
        }
      }
      inlineBackups.clear();

      const root = page.document.documentElement;
      if (root.getAttribute(ROOT_SCHEME_ATTR) === 'recolor') {
        root.removeAttribute(ROOT_SCHEME_ATTR);
      }
    },
  };
}

export const cssRecolorStrategy = createCssRecolorStrategy();
