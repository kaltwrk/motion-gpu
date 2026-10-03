import type { Component } from 'svelte';
import type { SVGAttributes } from 'svelte/elements';

export type IconProps = Omit<SVGAttributes<SVGSVGElement>, 'children'> & {
	size?: number | string;
	strokeWidth?: number | string;
	title?: string;
};

export type IconComponent = Component<IconProps>;
