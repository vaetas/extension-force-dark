import type { PageThemeStatus } from '../storage/settings';
import { filterFallbackStrategy } from './strategies/filter-fallback';
import { cssRecolorStrategy } from './strategies/css-recolor';
import { nativeSchemeStrategy } from './strategies/native-scheme';
import type { PageContext, PageThemeStrategy, ThemeMode } from './types';

const strategies: PageThemeStrategy[] = [
  nativeSchemeStrategy,
  cssRecolorStrategy,
  filterFallbackStrategy,
];

export interface PipelineResult {
  mode: ThemeMode;
  status: PageThemeStatus;
}

export async function applyThemePipeline(
  page: PageContext,
): Promise<PipelineResult> {
  const applied: PageThemeStrategy[] = [];

  for (const strategy of strategies) {
    const result = await strategy.apply(page);
    if (result === 'handled') {
      applied.push(strategy);
      return {
        mode: strategy.id,
        status: strategy.id === 'none' ? 'idle' : strategy.id,
      };
    }
    // Native may partially set color-scheme; keep it if later strategies run.
    if (strategy.id === 'native') {
      applied.push(strategy);
    }
  }

  return { mode: 'none', status: 'idle' };
}

export function revertThemePipeline(page: PageContext): void {
  for (const strategy of [...strategies].reverse()) {
    strategy.revert(page);
  }
}
