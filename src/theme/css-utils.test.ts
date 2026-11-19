import { describe, expect, it } from 'vitest';
import { rewriteRuleDeclarations } from './css-utils';
import type { ColorRole } from './types';

describe('rewriteRuleDeclarations', () => {
  it('rewrites background-color and color while leaving url images and display alone', () => {
    const result = rewriteRuleDeclarations({
      'background-color': '#ffffff',
      color: '#000000',
      'background-image': 'url(https://example.com/photo.jpg)',
      display: 'flex',
    });

    expect(result['background-color']).toBeTruthy();
    expect(result['background-color']).not.toBe('#ffffff');
    expect(result.color).toBeTruthy();
    expect(result.color).not.toBe('#000000');
    expect(result['background-image']).toBeUndefined();
    expect(result.display).toBeUndefined();
  });

  it('does not rewrite a mixed-role custom property at the variable definition', () => {
    const roles = new Map<string, Set<ColorRole>>([
      ['--token', new Set<ColorRole>(['background', 'foreground'])],
    ]);

    const result = rewriteRuleDeclarations(
      {
        '--token': '#ffffff',
        color: 'var(--token)',
        'background-color': 'var(--token)',
      },
      roles,
    );

    expect(result['--token']).toBeUndefined();
    expect(result.color).toBeUndefined();
    expect(result['background-color']).toBeUndefined();
  });

  it('rewrites a single-role custom property', () => {
    const roles = new Map<string, Set<ColorRole>>([
      ['--bg', new Set<ColorRole>(['background'])],
    ]);

    const result = rewriteRuleDeclarations(
      {
        '--bg': '#ffffff',
      },
      roles,
    );

    expect(result['--bg']).toBeTruthy();
    expect(result['--bg']).not.toBe('#ffffff');
  });
});
