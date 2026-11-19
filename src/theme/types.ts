export type StrategyResult = 'handled' | 'continue';

export type ThemeMode = 'native' | 'recolor' | 'filter' | 'none';

export interface PageContext {
  origin: string;
  href: string;
  isTopFrame: boolean;
  document: Document;
}

export interface PageThemeStrategy {
  id: ThemeMode;
  apply(page: PageContext): Promise<StrategyResult> | StrategyResult;
  revert(page: PageContext): void;
}

export type ColorRole = 'background' | 'foreground' | 'border' | 'shadow';

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface HSLA {
  h: number;
  s: number;
  l: number;
  a: number;
}
