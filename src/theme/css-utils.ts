import {
  ensureContrast,
  isColorProperty,
  parseColor,
  rewriteColorsInValue,
  roleForProperty,
} from './color';
import type { ColorRole } from './types';

export const EXTENSION_STYLE_ID = 'force-dark-overrides';
export const FILTER_STYLE_ID = 'force-dark-filter';
export const ROOT_SCHEME_ATTR = 'data-force-dark';

export interface CssOverride {
  selector: string;
  property: string;
  value: string;
  important: boolean;
}

export interface VariableUsage {
  name: string;
  roles: Set<ColorRole>;
}

const SKIP_PROPERTIES = new Set([
  'display',
  'position',
  'width',
  'height',
  'margin',
  'padding',
  'font',
  'font-size',
  'font-family',
  'filter',
  'transform',
  'animation',
  'transition',
]);

export function shouldProcessProperty(property: string): boolean {
  if (SKIP_PROPERTIES.has(property)) return false;
  return isColorProperty(property);
}

export function collectVariableUsages(
  rules: Iterable<CSSRule>,
): Map<string, VariableUsage> {
  const usages = new Map<string, VariableUsage>();

  const visit = (ruleList: CSSRuleList | Iterable<CSSRule>) => {
    for (const rule of Array.from(ruleList as CSSRuleList)) {
      if (rule instanceof CSSStyleRule) {
        for (let i = 0; i < rule.style.length; i += 1) {
          const property = rule.style.item(i);
          const value = rule.style.getPropertyValue(property);
          const role = roleForProperty(property);
          if (!role) continue;
          const matches = value.matchAll(/var\(\s*(--[\w-]+)/g);
          for (const match of matches) {
            const name = match[1];
            let usage = usages.get(name);
            if (!usage) {
              usage = { name, roles: new Set() };
              usages.set(name, usage);
            }
            usage.roles.add(role);
          }
        }
      } else if (
        rule instanceof CSSMediaRule ||
        rule instanceof CSSSupportsRule ||
        (typeof CSSLayerBlockRule !== 'undefined' &&
          rule instanceof CSSLayerBlockRule)
      ) {
        visit((rule as CSSGroupingRule).cssRules);
      }
    }
  };

  visit(rules);
  return usages;
}

export function rewriteDeclaration(
  property: string,
  value: string,
  important: boolean,
  siblingBg?: string,
): CssOverride | null {
  if (!shouldProcessProperty(property)) return null;

  // Pure image backgrounds stay untouched.
  if (
    (property === 'background-image' || property === 'background') &&
    /^url\(/i.test(value.trim()) &&
    !/gradient/i.test(value)
  ) {
    return null;
  }

  if (property.startsWith('--')) {
    return null;
  }

  const role = roleForProperty(property);
  if (!role) return null;

  let rewritten = rewriteColorsInValue(value, role);
  if (!rewritten) return null;

  if (
    role === 'foreground' &&
    siblingBg &&
    property === 'color'
  ) {
    const fg = parseColor(rewritten);
    const bg = parseColor(siblingBg);
    if (fg && bg) {
      const ensured = ensureContrast(fg, bg);
      rewritten = `rgba(${ensured.r}, ${ensured.g}, ${ensured.b}, ${ensured.a})`;
    }
  }

  return {
    selector: '',
    property,
    value: rewritten,
    important,
  };
}

export function buildOverrideSheet(overrides: CssOverride[]): string {
  const bySelector = new Map<string, CssOverride[]>();
  for (const override of overrides) {
    const list = bySelector.get(override.selector) ?? [];
    list.push(override);
    bySelector.set(override.selector, list);
  }

  const chunks: string[] = [];
  for (const [selector, decls] of bySelector) {
    if (!selector) continue;
    const body = decls
      .map(
        (d) =>
          `${d.property}: ${d.value}${d.important ? ' !important' : ''};`,
      )
      .join(' ');
    chunks.push(`${selector} { ${body} }`);
  }
  return chunks.join('\n');
}

export function walkStyleRules(
  sheet: CSSStyleSheet,
  visitor: (rule: CSSStyleRule, mediaOk: boolean) => void,
  mediaOk = true,
): void {
  let rules: CSSRuleList;
  try {
    rules = sheet.cssRules;
  } catch {
    return;
  }

  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      visitor(rule, mediaOk);
    } else if (rule instanceof CSSMediaRule) {
      const media = rule.media.mediaText.toLowerCase();
      if (media.includes('print')) continue;
      walkStyleRules(
        { cssRules: rule.cssRules } as CSSStyleSheet,
        visitor,
        mediaOk,
      );
    } else if (
      rule instanceof CSSSupportsRule ||
      (typeof CSSLayerBlockRule !== 'undefined' &&
        rule instanceof CSSLayerBlockRule)
    ) {
      walkStyleRules(
        { cssRules: (rule as CSSGroupingRule).cssRules } as CSSStyleSheet,
        visitor,
        mediaOk,
      );
    }
  }
}

/** Pure helper for tests: rewrite a map of declarations. */
export function rewriteRuleDeclarations(
  declarations: Record<string, string>,
  variableRoles?: Map<string, Set<ColorRole>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  const bgValue = declarations['background-color'] ?? declarations.background;
  let rewrittenBg: string | undefined;

  for (const [property, value] of Object.entries(declarations)) {
    if (property.startsWith('--')) {
      const roles = variableRoles?.get(property);
      if (roles && roles.size === 1) {
        const role = [...roles][0];
        const rewritten = rewriteColorsInValue(value, role);
        if (rewritten) result[property] = rewritten;
      }
      continue;
    }

    if (
      (property === 'background-image' || property === 'background') &&
      /^url\(/i.test(value.trim()) &&
      !/gradient/i.test(value)
    ) {
      continue;
    }

    if (!isColorProperty(property) || property === 'display') {
      continue;
    }

    const role = roleForProperty(property);
    if (!role) continue;
    if (value.includes('var(')) continue;

    let rewritten = rewriteColorsInValue(value, role);
    if (!rewritten) continue;

    if (role === 'background') {
      rewrittenBg = rewritten;
    }

    if (role === 'foreground' && property === 'color') {
      const sibling = rewrittenBg
        ? rewrittenBg
        : bgValue
          ? rewriteColorsInValue(bgValue, 'background') ?? bgValue
          : undefined;
      if (sibling) {
        const fg = parseColor(rewritten);
        const bg = parseColor(sibling);
        if (fg && bg) {
          const ensured = ensureContrast(fg, bg);
          rewritten = `rgba(${ensured.r}, ${ensured.g}, ${ensured.b}, ${ensured.a})`;
        }
      }
    }

    result[property] = rewritten;
  }

  return result;
}
