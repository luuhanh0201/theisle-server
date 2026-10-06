// The types of portal/public/skin-editor.js (imported as @portal/skin-editor, aliases.ts): its data and colour maths.
export interface LinearColor { r: number; g: number; b: number }
export const REGIONS: ReadonlyArray<readonly [string, string]>;
export const PRESETS: ReadonlyArray<{ name: string; colors: Record<string, string> }>;
export const DEFAULT_COLORS: Record<string, LinearColor>;
export function hex(c: LinearColor | null | undefined): string;
export function linearOf(hexText: string): LinearColor;
export const LIGHT_MIN: number;
export const LIGHT_MAX: number;
export function lightText(f: number): [string, '' | 'dark' | 'bright'];
export const lightSlider: { min: number; max: number; toSlider: (f: number) => number; value: (el: { value: string; min: string; max: string }) => number };
