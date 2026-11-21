import {
  ensureContrast,
  isColorProperty,
  parseColor,
  rewriteChannelTriplet,
  rewriteColorsInValue,
  roleForProperty,
} from './color';
import type { ColorRole } from './types';

export const EXTENSION_STYLE_ID = 'force-dark-overrides';
export const INVERT_STYLE_ID = 'force-dark-invert';
export const FLASH_STYLE_ID = 'force-dark-flash';
export const ROOT_SCHEME_ATTR = 'data-force-dark';
/** Attribute shared with the MAIN-world script to switch matchMedia forcing. */
export const SCHEME_ATTR = 'data-force-dark-scheme';
export const SCHEME_READY_ATTR = 'data-force-dark-scheme-ready';

export interface Declaration {
  property: string;
  value: string;
  important: boolean;
}

export interface CssOverride extends Declaration {
  selector: string;
  /** Wrapping at-rule preludes, outermost first, e.g. `@media (min-width: 600px)`. */
  context: string[];
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
  'color-scheme',
]);

export function shouldProcessProperty(property: string): boolean {
  if (SKIP_PROPERTIES.has(property)) return false;
  return isColorProperty(property);
}

const ROLE_TAG: Record<ColorRole, string> = {
  background: 'bg',
  foreground: 'fg',
  border: 'border',
  shadow: 'shadow',
};

export function roleVarName(name: string, role: ColorRole): string {
  return `--fd-${ROLE_TAG[role]}--${name.slice(2)}`;
}

/**
 * Wrap every `var(--x, fb)` as `var(--fd-<role>--x, var(--x, fb))` so a
 * role-specific dark variant wins when one exists and the original value
 * remains the fallback otherwise.
 */
export function rewriteVarRefs(value: string, role: ColorRole): string {
  let out = '';
  let i = 0;
  while (i < value.length) {
    const idx = value.indexOf('var(', i);
    if (idx < 0) {
      out += value.slice(i);
      break;
    }
    out += value.slice(i, idx);
    let depth = 0;
    let j = idx + 3;
    for (; j < value.length; j += 1) {
      if (value[j] === '(') depth += 1;
      else if (value[j] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (j >= value.length) {
      out += value.slice(idx);
      break;
    }
    const inner = value.slice(idx + 4, j);
    const match = /^\s*(--[\w-]+)\s*(?:,([\s\S]*))?$/.exec(inner);
    if (!match || match[1].startsWith('--fd-')) {
      out += value.slice(idx, j + 1);
    } else {
      const fallback =
        match[2] !== undefined ? `,${rewriteVarRefs(match[2], role)}` : '';
      out += `var(${roleVarName(match[1], role)}, var(${match[1]}${fallback}))`;
    }
    i = j + 1;
  }
  return out;
}

/** Rewrite literal colors and var() references for a property of `role`. */
export function rewriteValueForRole(
  value: string,
  role: ColorRole,
): string | null {
  const colored = rewriteColorsInValue(value, role);
  const base = colored ?? value;
  const wrapped = value.includes('var(') ? rewriteVarRefs(base, role) : base;
  return colored !== null || wrapped !== base ? wrapped : null;
}

export interface VariableDecl {
  property: string;
  value: string;
}

/**
 * Which color roles each custom property ends up being used as, following
 * `--a: var(--b)` aliases transitively.
 */
export function computeVariableRoles(
  decls: Iterable<VariableDecl>,
): Map<string, Set<ColorRole>> {
  const roles = new Map<string, Set<ColorRole>>();
  const aliases: Array<[string, string]> = [];
  const add = (name: string, role: ColorRole): boolean => {
    let set = roles.get(name);
    if (!set) {
      set = new Set();
      roles.set(name, set);
    }
    if (set.has(role)) return false;
    set.add(role);
    return true;
  };

  for (const { property, value } of decls) {
    if (!value.includes('var(')) continue;
    const refs = [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);
    if (property.startsWith('--')) {
      for (const ref of refs) aliases.push([property, ref]);
      continue;
    }
    const role = roleForProperty(property);
    if (!role) continue;
    for (const ref of refs) add(ref, role);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [definer, ref] of aliases) {
      const definerRoles = roles.get(definer);
      if (!definerRoles) continue;
      for (const role of [...definerRoles]) {
        if (add(ref, role)) changed = true;
      }
    }
  }
  return roles;
}

const UNKNOWN_USE_ROLES: ColorRole[] = ['background', 'foreground', 'border'];

/** Role-specific dark companions for one custom property definition. */
export function deriveRoleVariables(
  name: string,
  value: string,
  roles: Set<ColorRole> | undefined,
): Array<{ property: string; value: string }> {
  const out: Array<{ property: string; value: string }> = [];
  const list = roles && roles.size > 0 ? [...roles] : UNKNOWN_USE_ROLES;
  for (const role of list) {
    const rewritten =
      rewriteValueForRole(value, role) ?? rewriteChannelTriplet(value, role);
    if (rewritten && rewritten !== value) {
      out.push({ property: roleVarName(name, role), value: rewritten });
    }
  }
  return out;
}

/** Rewrite the color-bearing declarations of one rule. */
export function rewriteDeclarations(
  decls: Declaration[],
  variableRoles: Map<string, Set<ColorRole>> = new Map(),
): Declaration[] {
  const out: Declaration[] = [];
  const bgDecl =
    decls.find((d) => d.property === 'background-color') ??
    decls.find((d) => d.property === 'background');
  const siblingBg = bgDecl
    ? rewriteColorsInValue(bgDecl.value, 'background')
    : null;

  for (const { property, value, important } of decls) {
    if (!shouldProcessProperty(property)) continue;

    if (property.startsWith('--')) {
      for (const derived of deriveRoleVariables(
        property,
        value,
        variableRoles.get(property),
      )) {
        out.push({ ...derived, important });
      }
      continue;
    }

    const role = roleForProperty(property);
    if (!role) continue;

    let rewritten = rewriteValueForRole(value, role);
    if (!rewritten) continue;

    if (role === 'foreground' && property === 'color' && siblingBg) {
      const fg = parseColor(rewritten);
      const bg = parseColor(siblingBg);
      if (fg && bg) {
        const ensured = ensureContrast(fg, bg);
        rewritten = `rgba(${ensured.r}, ${ensured.g}, ${ensured.b}, ${ensured.a})`;
      }
    }

    out.push({ property, value: rewritten, important });
  }
  return out;
}

/** Defaults for everything the page leaves to the browser. Low specificity. */
export const BASE_LAYER_CSS = `
html { color-scheme: dark; }
:where(html, body) { background-color: #181a1b; color: #e8e6e3; }
:where(input, textarea, select, button) { background-color: #202324; color: #e8e6e3; border-color: #4a4d50; }
:where(a:link) { color: #7cb7ff; }
:where(a:visited) { color: #b79cff; }
::placeholder { color: #9a9a9a; }
::selection { background-color: #2b5c99; color: #fff; }
html { scrollbar-color: #454a4d #202324; }
`;

export function buildOverrideSheet(overrides: CssOverride[]): string {
  const chunks: string[] = [];
  let i = 0;
  while (i < overrides.length) {
    const head = overrides[i];
    const contextKey = head.context.join('\u0000');
    const decls: string[] = [];
    while (
      i < overrides.length &&
      overrides[i].selector === head.selector &&
      overrides[i].context.join('\u0000') === contextKey
    ) {
      const d = overrides[i];
      decls.push(`${d.property}: ${d.value}${d.important ? ' !important' : ''};`);
      i += 1;
    }
    let css = `${head.selector} { ${decls.join(' ')} }`;
    for (let c = head.context.length - 1; c >= 0; c -= 1) {
      css = `${head.context[c]} { ${css} }`;
    }
    chunks.push(css);
  }
  return chunks.join('\n');
}

/**
 * Visit style rules with their wrapping at-rule context. `@layer` is flattened
 * on purpose: our unlayered sheet already outranks every layered rule.
 */
export function walkStyleRules(
  rules: CSSRuleList,
  visitor: (rule: CSSStyleRule, context: string[]) => void,
  context: string[] = [],
): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      visitor(rule, context);
    } else if (rule instanceof CSSMediaRule) {
      if (/\bprint\b/i.test(rule.media.mediaText)) continue;
      walkStyleRules(rule.cssRules, visitor, [
        ...context,
        `@media ${rule.media.mediaText}`,
      ]);
    } else if (rule instanceof CSSSupportsRule) {
      walkStyleRules(rule.cssRules, visitor, [
        ...context,
        `@supports ${rule.conditionText}`,
      ]);
    } else if (
      typeof CSSLayerBlockRule !== 'undefined' &&
      rule instanceof CSSLayerBlockRule
    ) {
      walkStyleRules(rule.cssRules, visitor, context);
    }
  }
}

/**
 * Split a declaration block into declarations. Parsed from text rather than
 * the CSSOM longhand list: browsers expand `background: var(--x)` into empty
 * longhands, which would hide exactly the declarations we need to rewrite.
 */
export function parseDeclarations(text: string): Declaration[] {
  const decls: Declaration[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;

  const flush = (end: number): void => {
    const chunk = text.slice(start, end).trim();
    start = end + 1;
    if (!chunk) return;
    const colon = chunk.indexOf(':');
    if (colon <= 0) return;
    const property = chunk.slice(0, colon).trim();
    let value = chunk.slice(colon + 1).trim();
    let important = false;
    const m = /\s*!\s*important\s*$/i.exec(value);
    if (m) {
      important = true;
      value = value.slice(0, m.index).trim();
    }
    decls.push({
      property: property.startsWith('--') ? property : property.toLowerCase(),
      value,
      important,
    });
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) flush(i);
  }
  flush(text.length);
  return decls;
}

export function declarationsOf(style: CSSStyleDeclaration): Declaration[] {
  return parseDeclarations(style.cssText);
}
