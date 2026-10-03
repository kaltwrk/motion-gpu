/** Sidebar order, routes and page metadata for the playground examples. */
export const playgroundPages = [
	{ id: 'spektral-logo', slug: '', title: 'Spektral Logo' },
	{ id: 'blood-moon', slug: 'blood-moon', title: 'Blood Moon' },
	{ id: 'data-mosh', slug: 'data-mosh', title: 'Data Mosh' },
	{ id: 'diamond', slug: 'diamond', title: 'Diamond' },
	{ id: 'glass-pane', slug: 'glass-pane', title: 'Glass Pane' },
	{ id: 'particle-icosahedron', slug: 'particle-icosahedron', title: 'Particle Icosahedron' },
	{ id: 'ping-pong-fluid', slug: 'ping-pong-fluid', title: 'Ping Pong Fluid' },
	{ id: 'rubiks-cube', slug: 'rubiks-cube', title: 'Rubiks Cube' },
	{ id: 'spectral-tension', slug: 'spectral-tension', title: 'Spectral Tension' },
	{ id: 'tanstack', slug: 'tanstack', title: 'TanStack' },
	{
		id: 'typegpu-resolve-codegen',
		slug: 'typegpu-resolve-codegen',
		title: 'TypeGPU Resolve Codegen'
	}
].map((demo) => ({
	...demo,
	description: `Edit the ${demo.title} example in Svelte, React, or Vue and preview it live.`
}));

export function getPlaygroundPage(id: string) {
	const demo = playgroundPages.find((entry) => entry.id === id);
	if (!demo) throw new Error(`Register playground demo ${id} in site/playground.ts.`);
	return demo;
}
