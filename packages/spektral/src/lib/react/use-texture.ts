import { useEffect, useLayoutEffect, useRef } from 'react';
import { type CurrentReadable } from '../core/current-value.js';
import { createTextureLoadController } from '../core/texture-load-controller.js';
import { type LoadedTexture, type TextureLoadOptions } from '../core/texture-loader.js';
import { type SpektralErrorReport } from '../core/error-report.js';

/**
 * Reactive state returned by `useTexture`.
 */
export interface UseTextureResult {
	/**
	 * Loaded textures or `null` when unavailable/failed.
	 */
	textures: CurrentReadable<LoadedTexture[] | null>;
	/**
	 * `true` while an active load request is running.
	 */
	loading: CurrentReadable<boolean>;
	/**
	 * Last loading error.
	 */
	error: CurrentReadable<Error | null>;
	/**
	 * Last loading error normalized to Spektral diagnostics report shape.
	 */
	errorReport: CurrentReadable<SpektralErrorReport | null>;
	/**
	 * Reloads all textures using current URL input.
	 */
	reload: () => Promise<void>;
}

/**
 * Supported URL input variants for `useTexture`.
 */
export type TextureUrlInput = string[] | (() => string[]);

/**
 * Loads textures from URLs and exposes reactive loading/error state.
 *
 * @param urlInput - URLs array or lazy URL provider.
 * @param options - Loader options passed to URL fetch/decode pipeline.
 * @returns Reactive texture loading state with reload support.
 */
export function useTexture(
	urlInput: TextureUrlInput,
	options: TextureLoadOptions = {}
): UseTextureResult {
	const optionsRef = useRef(options);
	const urlInputRef = useRef(urlInput);
	const controllerRef = useRef<ReturnType<typeof createTextureLoadController> | null>(null);

	useLayoutEffect(() => {
		optionsRef.current = options;
		urlInputRef.current = urlInput;
	}, [options, urlInput]);
	controllerRef.current ??= createTextureLoadController({
		getUrls: () => {
			const input = urlInputRef.current;
			return typeof input === 'function' ? input() : input;
		},
		getOptions: () => optionsRef.current
	});
	const controller = controllerRef.current;

	useEffect(() => {
		controller.resume();
		void controller.reload();
		return controller.dispose;
	}, [controller]);

	return {
		textures: controller.textures,
		loading: controller.loading,
		error: controller.error,
		errorReport: controller.errorReport,
		reload: controller.reload
	};
}
