import { managedPassBrand, selectFeedbackOwner } from '../../lib/core/pass-brand.js';
import {
	computePassStaticTopology,
	createComputePassStaticTopology
} from '../../lib/core/compute-pass-static-topology.js';
import { resolveComputePingPongResourcePair } from '../../lib/core/compute-resources.js';
import type { ComputePassLike, PingPongShaderPassLike } from '../../lib/core/types.js';

const DEFAULT_COMPUTE = `
@compute @workgroup_size(1)
fn compute(@builtin(global_invocation_id) id: vec3u) {
	_ = id;
}
`;

/** Creates a nominal renderer-managed compute stub for internal runtime tests. */
export function createManagedComputePass(
	overrides: Partial<ComputePassLike> = {}
): ComputePassLike {
	const getResources = overrides.getResources ?? (() => ({}));
	const topology = createComputePassStaticTopology(
		overrides.isPingPong === true ? 'ping-pong-compute' : 'compute',
		getResources(),
		overrides.isPingPong === true ? resolveComputePingPongResourcePair : undefined
	);
	return {
		[managedPassBrand]: 'compute',
		[computePassStaticTopology]: topology,
		isCompute: true,
		enabled: true,
		dispose: () => {},
		getCompute: () => DEFAULT_COMPUTE,
		getResources,
		getWorkgroupSize: () => [1, 1, 1],
		resolveDispatch: () => [1, 1, 1],
		...overrides
	} as ComputePassLike;
}

/** Creates a nominal renderer-managed feedback stub for internal graph tests. */
export function createManagedFeedbackPass(
	overrides: Partial<PingPongShaderPassLike> = {}
): PingPongShaderPassLike {
	return {
		[managedPassBrand]: 'feedback',
		[selectFeedbackOwner]: () => {},
		isPingPongShader: true,
		enabled: true,
		dispose: () => {},
		getTarget: () => 'feedback',
		getFragment: () => 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
		getFragmentLineMap: () => [],
		resolveSize: ({ width, height }) => ({ width, height }),
		getIterations: () => 1,
		getFormat: () => 'rgba16float',
		getFilter: () => 'linear',
		getAddressModeU: () => 'clamp-to-edge',
		getAddressModeV: () => 'clamp-to-edge',
		getClearColor: () => [0, 0, 0, 0],
		getCurrentOutput: () => 'feedbackA',
		advanceFrame: () => {},
		consumeResetColor: () => null,
		...overrides
	};
}
