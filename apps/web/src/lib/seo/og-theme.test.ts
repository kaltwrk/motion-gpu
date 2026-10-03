import { describe, expect, it, vi } from 'vitest';
import { siteConfig } from '$lib/site/site';

vi.mock('../site/theme.css?raw', async () => {
	const { readFile } = await import('node:fs/promises');
	return {
		default: await readFile(new URL('../site/theme.css', import.meta.url), 'utf8')
	};
});

import {
	extractCustomProperties,
	ogThemeColors,
	resolveCustomProperty,
	toSvgColor,
	withAlpha
} from './og-theme';

describe('OG theme colors', () => {
	it('resolves nested CSS token references for both themes', () => {
		expect(ogThemeColors.light.backgroundInset).toBe('oklch(1 0 0)');
		expect(ogThemeColors.dark.backgroundInset).toBe('oklch(0.19 0.006 285.885)');
		expect(ogThemeColors.dark.accent).toBe('oklch(0.5772 0.205 278.37)');
	});

	it('keeps browser chrome colors synchronized with inset surfaces', () => {
		expect(siteConfig.themeColor.light).toBe(toSvgColor(ogThemeColors.light.backgroundInset));
		expect(siteConfig.themeColor.dark).toBe(toSvgColor(ogThemeColors.dark.backgroundInset));
	});

	it('converts OKLCH colors and alpha to SVG-safe colors', () => {
		expect(toSvgColor('oklch(1 0 0)')).toBe('#ffffff');
		expect(toSvgColor('oklch(0 0 0)')).toBe('#000000');
		expect(toSvgColor('oklch(1 0 0 / 0.5)')).toBe('#ffffff80');
		expect(withAlpha('oklch(1 0 0)', 0.58)).toBe('rgba(255, 255, 255, 0.58)');
		expect(withAlpha(ogThemeColors.dark.foreground, 0.58)).toBe('rgba(250, 250, 250, 0.58)');
	});

	it('reports missing theme blocks and token references', () => {
		expect(() => extractCustomProperties(':root { --foreground: white; }', '.dark')).toThrow(
			'Could not find the .dark theme block'
		);
		expect(() => resolveCustomProperty('--missing', new Map())).toThrow(
			'Could not find --missing in the CSS theme tokens'
		);
	});

	it('rejects circular custom-property references', () => {
		const properties = new Map([
			['--first', 'var(--second)'],
			['--second', 'var(--first)']
		]);

		expect(() => resolveCustomProperty('--first', properties)).toThrow(
			'Circular CSS custom property reference detected for --first'
		);
	});
});
