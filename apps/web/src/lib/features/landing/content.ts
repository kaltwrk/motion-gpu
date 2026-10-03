import {
	CubesIcon,
	LayersIcon,
	CubeAxisIcon,
	TriangleWarningIcon,
	CodeIcon,
	DatabaseIcon,
	TouchClickIcon,
	CubeIcon
} from '$lib/icons';

// This product page is independent of the docs/workspace template configuration.
export const navigation = [
	{ label: 'Home', href: '#home' },
	{ label: 'Features', href: '#features' },
	{ label: 'Pipeline', href: '#how-it-works' },
	{ label: 'FAQ', href: '#faq' }
] as const;

export const githubUrl = 'https://github.com/kaltwrk/spektral';

export const footerGroups = [
	{
		label: 'Menu',
		links: [
			{ label: 'Home', href: '/' },
			{ label: 'Docs', href: '/docs' },
			{ label: 'Playground', href: '/playground' }
		]
	},
	{
		label: 'Follow',
		links: [
			{ label: 'GitHub', href: githubUrl },
			{ label: 'npm', href: 'https://www.npmjs.com/package/spektral' }
		]
	},
	{
		label: 'Contact',
		links: [
			{ label: 'Issues', href: `${githubUrl}/issues` },
			{ label: 'Discussions', href: `${githubUrl}/discussions` }
		]
	},
	{ label: 'Project', links: [{ label: 'License', href: `${githubUrl}/blob/master/LICENSE` }] }
] as const;

export const features = [
	{
		title: 'Material Contracts',
		description:
			'Define WGSL materials with strict validation for uniforms, textures, includes, and defines before runtime surprises happen.',
		icon: CubesIcon
	},
	{
		title: 'Frame Scheduling',
		description:
			'Orchestrate deterministic frame flow with explicit ordering, stages, and invalidation behavior tailored to your scene.',
		icon: LayersIcon
	},
	{
		title: 'Post Processing',
		description:
			'Compose render passes and named render targets to scale from one fullscreen shader to full visual pipelines.',
		icon: CubeAxisIcon
	},
	{
		title: 'Error Diagnostics',
		description:
			'Normalize WebGPU and WGSL failures into structured reports with source snippets, actionable hints, and production-ready error handling.',
		icon: TriangleWarningIcon
	}
] as const;

export const steps = [
	{
		number: '01',
		title: 'Define Material',
		description: 'Start with a strict fragment contract and a deterministic material definition.',
		icon: CodeIcon
	},
	{
		number: '02',
		title: 'Declare Inputs',
		description:
			'Attach typed uniforms, textures, defines, and includes so runtime data stays explicit and verifiable.',
		icon: DatabaseIcon
	},
	{
		number: '03',
		title: 'Drive Runtime State',
		description:
			'Use useFrame and context APIs to update uniforms or textures with deterministic scheduling behavior.',
		icon: TouchClickIcon
	},
	{
		number: '04',
		title: 'Compose Passes',
		description:
			'Chain ShaderPass, BlitPass, and CopyPass with render targets to build post-processing pipelines.',
		icon: CubeIcon
	},
	{
		number: '05',
		title: 'Inspect and Tune',
		description:
			'Use normalized errors and scheduler diagnostics to debug quickly and tighten frame-time budgets.',
		icon: TriangleWarningIcon
	}
] as const;

export const faqItems = [
	{
		question: 'Which frameworks can I use it with?',
		answer:
			'Spektral has adapters for Svelte 5, React 19, and Vue 3.5. Each uses the same core runtime, so your shader and material definitions carry across frameworks. You can also use the core directly without a UI framework.'
	},
	{
		question: 'How much shader code do I need to write?',
		answer:
			'You provide the shader logic; Spektral handles WebGPU setup, GPU resources, and the render loop. Start from a playground example and edit its WGSL, or use TypeGPU to generate WGSL from TypeScript.'
	},
	{
		question: 'What happens when WebGPU is unavailable?',
		answer:
			'Spektral requires WebGPU and a secure context such as HTTPS or localhost. There is no WebGL fallback. Initialization failures reach your onError callback, where your app can choose to show a static image or another alternative.'
	},
	{
		question: 'Does the effect have to fill the whole page?',
		answer:
			'FragCanvas fills its container, and you control that container with CSS. An effect can live inside a small card or cover an entire page. Fullscreen rendering means the shader covers the canvas, whatever size you give it.'
	},
	{
		question: 'Does it need to render every frame?',
		answer:
			'Continuous rendering is the default. For effects that only change on interaction, use on-demand rendering and request a frame when needed. Manual mode lets you advance rendering explicitly, for example when capturing an image. These modes control GPU rendering; the scheduler still runs.'
	},
	{
		question: 'Can I use it as a 3D engine?',
		answer:
			'Spektral has no scene graph, mesh system, or built-in cameras. It suits effects drawn in a shader, including raymarched scenes, image processing, and simulations. If you need to load 3D models and arrange a scene, choose a dedicated 3D engine.'
	}
] as const;
