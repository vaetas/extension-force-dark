import type { FetchStylesheetResponse } from '../../messaging/protocol';
import {
  ensureContrast,
  parseColor,
  rewriteColorsInValue,
  roleForProperty,
} from '../color';
import {
  buildOverrideSheet,
  collectVariableUsages,
  EXTENSION_STYLE_ID,
  ROOT_SCHEME_ATTR,
  shouldProcessProperty,
  walkStyleRules,
  type CssOverride,
} from '../css-utils';
import type {
  ColorRole,
  PageContext,
  PageThemeStrategy,
  StrategyResult,
} from '../types';

interface InlineBackup {
  element: HTMLElement;
  property: string;
  value: string;
  priority: string;
}

const MAX_SHEET_BYTES = 2 * 1024 * 1024;
const sheetCache = new Map<string, string>();

async function fetchCrossOriginCss(url: string): Promise<string | null> {
  const cached = sheetCache.get(url);
  if (cached != null) return cached;

  try {
    const response = (await browser.runtime.sendMessage({
      type: 'FETCH_STYLESHEET',
      url,
    })) as FetchStylesheetResponse;

    if (!response?.ok) return null;
    if (response.cssText.length > MAX_SHEET_BYTES) return null;
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

function getOrCreateStyleEl(doc: Document): HTMLStyleElement {
  let el = doc.getElementById(EXTENSION_STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = doc.createElement('style');
    el.id = EXTENSION_STYLE_ID;
    el.setAttribute('data-force-dark', 'overrides');
    (doc.head ?? doc.documentElement).appendChild(el);
  }
  return el;
}

function processStyleRule(
  rule: CSSStyleRule,
  variableRoles: Map<string, Set<ColorRole>>,
  overrides: CssOverride[],
): void {
  const selector = rule.selectorText;
  if (!selector) return;

  const bgRaw =
    rule.style.getPropertyValue('background-color') ||
    rule.style.getPropertyValue('background');
  let rewrittenBg: string | undefined;

  for (let i = 0; i < rule.style.length; i += 1) {
    const property = rule.style.item(i);
    const value = rule.style.getPropertyValue(property).trim();
    const important = rule.style.getPropertyPriority(property) === 'important';

    if (!shouldProcessProperty(property)) continue;

    if (property.startsWith('--')) {
      const roles = variableRoles.get(property);
      if (roles && roles.size === 1) {
        const role = [...roles][0];
        const rewritten = rewriteColorsInValue(value, role);
        if (rewritten) {
          overrides.push({
            selector: ':root, :host',
            property,
            value: rewritten,
            important,
          });
        }
      }
      continue;
    }

    if (
      (property === 'background-image' || property === 'background') &&
      /^url\(/i.test(value) &&
      !/gradient/i.test(value)
    ) {
      continue;
    }

    if (value.includes('var(')) continue;

    const role = roleForProperty(property);
    if (!role) continue;

    let rewritten = rewriteColorsInValue(value, role);
    if (!rewritten) continue;

    if (role === 'background') {
      rewrittenBg = rewritten;
    }

    if (role === 'foreground' && property === 'color') {
      const siblingSource = rewrittenBg
        ?? (bgRaw ? rewriteColorsInValue(bgRaw, 'background') : null);
      if (siblingSource) {
        const fg = parseColor(rewritten);
        const bg = parseColor(siblingSource);
        if (fg && bg) {
          const ensured = ensureContrast(fg, bg);
          rewritten = `rgba(${ensured.r}, ${ensured.g}, ${ensured.b}, ${ensured.a})`;
        }
      }
    }

    overrides.push({
      selector,
      property,
      value: rewritten,
      important,
    });
  }
}

async function gatherSheets(doc: Document): Promise<CSSStyleSheet[]> {
  const sheets: CSSStyleSheet[] = [];

  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      // Accessing cssRules throws for cross-origin sheets.
      void sheet.cssRules;
      sheets.push(sheet);
    } catch {
      const href = sheet.href;
      if (!href) continue;
      const cssText = await fetchCrossOriginCss(href);
      if (!cssText) continue;
      try {
        const constructed = new CSSStyleSheet();
        await constructed.replace(cssText);
        sheets.push(constructed);
      } catch {
        // Ignore unparsable sheets.
      }
    }
  }

  if (doc.adoptedStyleSheets?.length) {
    for (const sheet of doc.adoptedStyleSheets) {
      sheets.push(sheet);
    }
  }

  return sheets;
}

function rewriteInlineStyles(
  root: ParentNode,
  backups: InlineBackup[],
): number {
  let count = 0;
  const elements = root.querySelectorAll<HTMLElement>('[style]');
  for (const el of elements) {
    const style = el.style;
    for (let i = 0; i < style.length; i += 1) {
      const property = style.item(i);
      if (!shouldProcessProperty(property) || property.startsWith('--')) {
        continue;
      }
      const value = style.getPropertyValue(property);
      if (!value || value.includes('var(')) continue;
      const role = roleForProperty(property);
      if (!role) continue;
      const rewritten = rewriteColorsInValue(value, role);
      if (!rewritten || rewritten === value) continue;

      backups.push({
        element: el,
        property,
        value,
        priority: style.getPropertyPriority(property),
      });
      style.setProperty(
        property,
        rewritten,
        style.getPropertyPriority(property),
      );
      count += 1;
    }
  }
  return count;
}

function observeOpenShadows(
  doc: Document,
  onShadow: (root: ShadowRoot) => void,
): MutationObserver {
  const seen = new WeakSet<ShadowRoot>();

  const scan = (node: Node) => {
    if (!(node instanceof Element)) return;
    const shadow = (node as Element & { shadowRoot?: ShadowRoot | null })
      .shadowRoot;
    if (shadow && !seen.has(shadow)) {
      seen.add(shadow);
      onShadow(shadow);
    }
    for (const child of Array.from(node.children)) {
      scan(child);
    }
  };

  scan(doc.documentElement);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        scan(node);
      }
    }
  });
  observer.observe(doc.documentElement, { childList: true, subtree: true });
  return observer;
}

export function createCssRecolorStrategy(): PageThemeStrategy & {
  getOverrideCount: () => number;
} {
  let overrideCount = 0;
  let mutationObserver: MutationObserver | null = null;
  let shadowObserver: MutationObserver | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const inlineBackups: InlineBackup[] = [];

  const applyToDocument = async (doc: Document): Promise<number> => {
    const sheets = await gatherSheets(doc);
    const allRules: CSSRule[] = [];
    for (const sheet of sheets) {
      try {
        allRules.push(...Array.from(sheet.cssRules));
      } catch {
        // ignore
      }
    }

    const usages = collectVariableUsages(allRules);
    const variableRoles = new Map<string, Set<ColorRole>>();
    for (const [name, usage] of usages) {
      variableRoles.set(name, usage.roles);
    }

    const overrides: CssOverride[] = [];
    for (const sheet of sheets) {
      walkStyleRules(sheet, (rule) => {
        processStyleRule(rule, variableRoles, overrides);
      });
    }

    const styleEl = getOrCreateStyleEl(doc);
    styleEl.textContent = buildOverrideSheet(overrides);

    const inlineCount = rewriteInlineStyles(doc, inlineBackups);
    return overrides.length + inlineCount;
  };

  const strategy: PageThemeStrategy & { getOverrideCount: () => number } = {
    id: 'recolor',

    async apply(page: PageContext): Promise<StrategyResult> {
      const count = await applyToDocument(page.document);
      overrideCount = count;

      const scheduleRefresh = () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          overrideCount = await applyToDocument(page.document);
        }, 80);
      };

      mutationObserver?.disconnect();
      mutationObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (
            mutation.type === 'childList' ||
            mutation.type === 'attributes'
          ) {
            const target = mutation.target;
            if (
              target instanceof HTMLStyleElement ||
              target instanceof HTMLLinkElement ||
              (target instanceof HTMLElement &&
                mutation.attributeName === 'style')
            ) {
              scheduleRefresh();
              return;
            }
            for (const node of Array.from(mutation.addedNodes)) {
              if (
                node instanceof HTMLStyleElement ||
                node instanceof HTMLLinkElement
              ) {
                scheduleRefresh();
                return;
              }
            }
          }
        }
      });
      mutationObserver.observe(page.document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style'],
      });

      shadowObserver?.disconnect();
      shadowObserver = observeOpenShadows(page.document, (shadow) => {
        rewriteInlineStyles(shadow, inlineBackups);
      });

      if (count > 0) {
        page.document.documentElement.setAttribute(
          ROOT_SCHEME_ATTR,
          'recolor',
        );
        return 'handled';
      }
      return 'continue';
    },

    revert(page: PageContext): void {
      mutationObserver?.disconnect();
      mutationObserver = null;
      shadowObserver?.disconnect();
      shadowObserver = null;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }

      for (const backup of inlineBackups) {
        try {
          backup.element.style.setProperty(
            backup.property,
            backup.value,
            backup.priority,
          );
        } catch {
          // Element may be gone.
        }
      }
      inlineBackups.length = 0;

      page.document.getElementById(EXTENSION_STYLE_ID)?.remove();
      page.document.documentElement.removeAttribute(ROOT_SCHEME_ATTR);
      overrideCount = 0;
    },

    getOverrideCount: () => overrideCount,
  };

  return strategy;
}

export const cssRecolorStrategy = createCssRecolorStrategy();
