import { readPreference, writePreference } from './preferences';
import { browser } from '$app/environment';
import { contentUiDefaults } from '$lib/site/content-ui';

export type Framework = 'svelte' | 'react' | 'vue';

export const frameworks: Framework[] = contentUiDefaults.framework.enabled;

const STORAGE_KEY = contentUiDefaults.framework.storageKey;
const DATASET_KEY = 'docsFramework';

function isFramework(value: string | null): value is Framework {
	return frameworks.includes(value as Framework);
}

function getBootstrapFramework(): Framework | null {
	if (!browser) {
		return null;
	}

	const value = document.documentElement.dataset[DATASET_KEY] ?? null;
	return isFramework(value) ? value : null;
}

function syncBootstrapFramework(value: Framework): void {
	if (!browser) {
		return;
	}

	document.documentElement.dataset[DATASET_KEY] = value;
	document.documentElement.dataset.docsFramework = value;
}

function createFrameworkStore() {
	let active = $state<Framework>(contentUiDefaults.framework.default);

	if (browser) {
		let nextActive: Framework = contentUiDefaults.framework.default;
		const bootstrapped = getBootstrapFramework();
		if (bootstrapped) {
			nextActive = bootstrapped;
		} else {
			const stored = readPreference(STORAGE_KEY);
			if (isFramework(stored)) {
				nextActive = stored;
			}
		}

		active = nextActive;
		syncBootstrapFramework(nextActive);
	}

	return {
		get active() {
			return active;
		},
		set active(v: Framework) {
			active = v;
			if (browser) {
				writePreference(STORAGE_KEY, v);
				syncBootstrapFramework(v);
			}
		}
	};
}

export const frameworkStore = createFrameworkStore();
