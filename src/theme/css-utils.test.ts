import { describe, expect, it } from 'vitest';
import {
  buildOverrideSheet,
  computeVariableRoles,
  deriveRoleVariables,
  parseDeclarations,
  rewriteDeclarations,
  rewriteVarRefs,
  rewriteValueForRole,
} from './css-utils';

const decl = (property: string, value: string) => ({
  property,
  value,
  important: false,
});

describe('rewriteDeclarations', () => {
  it('rewrites colors but leaves url images and layout alone', () => {
    const out = rewriteDeclarations([
      decl('background-color', '#ffffff'),
      decl('color', '#000000'),
      decl('background-image', 'url(https://example.com/photo.jpg)'),
      decl('display', 'flex'),
    ]);
    const props = out.map((d) => d.property);
    expect(props).toEqual(['background-color', 'color']);
    expect(out[0].value).not.toBe('#ffffff');
    expect(out[1].value).not.toBe('#000000');
  });

  it('keeps the url when a shorthand also has a color', () => {
    const [bg] = rewriteDeclarations([
      decl('background', 'url(#hero) #ffffff no-repeat'),
    ]);
    expect(bg.value).toContain('url(#hero)');
    expect(bg.value).not.toContain('#ffffff');
  });

  it('emits role companions for custom properties', () => {
    const roles = computeVariableRoles([
      decl('background-color', 'var(--surface)'),
      decl('color', 'var(--surface)'),
    ]);
    const out = rewriteDeclarations([decl('--surface', '#ffffff')], roles);
    expect(out.map((d) => d.property).sort()).toEqual([
      '--fd-bg--surface',
      '--fd-fg--surface',
    ]);
  });

  it('wraps var() usages instead of skipping them', () => {
    const [bg] = rewriteDeclarations([
      decl('background-color', 'var(--surface, #fff)'),
    ]);
    expect(bg.value.startsWith('var(--fd-bg--surface, var(--surface,')).toBe(true);
  });
});

describe('rewriteVarRefs', () => {
  it('handles nested fallbacks and multiple refs', () => {
    expect(rewriteVarRefs('var(--a, var(--b))', 'background')).toBe(
      'var(--fd-bg--a, var(--a, var(--fd-bg--b, var(--b))))',
    );
    expect(rewriteVarRefs('rgb(var(--ch) / 50%)', 'foreground')).toBe(
      'rgb(var(--fd-fg--ch, var(--ch)) / 50%)',
    );
  });

  it('does not double wrap', () => {
    const once = rewriteVarRefs('var(--a)', 'border');
    expect(rewriteVarRefs(once, 'border')).toBe(once);
  });
});

describe('computeVariableRoles', () => {
  it('propagates roles through aliases', () => {
    const roles = computeVariableRoles([
      decl('--semantic', 'var(--palette)'),
      decl('background', 'var(--semantic)'),
    ]);
    expect([...(roles.get('--palette') ?? [])]).toEqual(['background']);
  });
});

describe('deriveRoleVariables', () => {
  it('rewrites rgb channel triplets', () => {
    const out = deriveRoleVariables('--c', '255, 255, 255', new Set(['background']));
    expect(out).toHaveLength(1);
    expect(out[0].value).not.toBe('255, 255, 255');
    expect(out[0].value).toMatch(/^\d+, \d+, \d+$/);
  });

  it('ignores non-color values', () => {
    expect(deriveRoleVariables('--gap', '16px', undefined)).toEqual([]);
  });
});

describe('rewriteValueForRole', () => {
  it('does not touch color words inside custom property names', () => {
    expect(rewriteValueForRole('var(--blue-500)', 'foreground')).toContain(
      '--blue-500',
    );
  });
});

describe('buildOverrideSheet', () => {
  it('wraps media context and merges consecutive same-selector rules', () => {
    const css = buildOverrideSheet([
      { selector: '.a', property: 'color', value: 'red', important: false, context: [] },
      { selector: '.a', property: 'background', value: 'blue', important: true, context: [] },
      { selector: '.b', property: 'color', value: 'red', important: false, context: ['@media (max-width: 600px)'] },
    ]);
    expect(css).toBe(
      '.a { color: red; background: blue !important; }\n@media (max-width: 600px) { .b { color: red; } }',
    );
  });
});

describe('parseDeclarations', () => {
  it('keeps shorthands with var(), important flags and semicolons in urls', () => {
    expect(
      parseDeclarations(
        'background: var(--bg); color: red !important; --x: url("a;b"); b: url(data:image/png;base64,AAA)',
      ),
    ).toEqual([
      { property: 'background', value: 'var(--bg)', important: false },
      { property: 'color', value: 'red', important: true },
      { property: '--x', value: 'url("a;b")', important: false },
      { property: 'b', value: 'url(data:image/png;base64,AAA)', important: false },
    ]);
  });
});
