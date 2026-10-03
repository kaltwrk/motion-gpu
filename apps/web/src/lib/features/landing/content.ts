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

// Landing copy and section order preserved from the main branch's home components.
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
		question: 'What is Spektral?',
		answer:
			'Spektral is a minimalist WebGPU framework for building fast fullscreen shader visuals. It gives you a clean path from a single effect to a complete GPU-driven visual layer in your app.'
	},
	{
		question: 'Who is it for?',
		answer:
			'It is built for developers who want modern, high-performance visual effects without building a rendering stack from scratch.'
	},
	{
		question: 'Do I need WebGPU knowledge to use it?',
		answer:
			'No. You can start with a minimal shader and iterate quickly. As your project grows, Spektral still gives you full control over uniforms, textures, render flow, and post-processing.'
	},
	{
		question: 'How quickly can I ship something with it?',
		answer:
			'You can usually get a first visual running in minutes: install, define a material, mount FragCanvas, then tune in the playground and docs.'
	},
	{
		question: 'Is it production-friendly?',
		answer:
			'Yes. Spektral is designed for predictable behavior, explicit runtime control, and clear diagnostics so teams can move from prototype to production with confidence.'
	},
	{
		question: 'Is this a general 3D engine?',
		answer:
			'No. Spektral focuses on fullscreen fragment workflows and post-processing pipelines. If you need full scene graphs and 3D tooling, pair it with a dedicated 3D engine.'
	},
	{
		question: 'Where should I start first?',
		answer:
			'Start with the Playground for instant feedback, then follow Getting Started to move into real app code and production patterns.'
	}
] as const;
