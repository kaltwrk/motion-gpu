import {
	createComputeExternalResolutionState,
	registerComputeExternalResource,
	type ComputeExternalRegistration,
	resolveComputePassResources,
	resolveTrustedComputePassResources,
	type ComputeExternalResolutionState,
	type ComputeResourceResolverContext,
	type ResolvedComputePassResources
} from '../compute-resources.js';
import { attachSpektralErrorContext, createSpektralError } from '../error-report.js';
import {
	getComputePassStaticTopology,
	type ComputePassStaticTopology
} from '../compute-pass-static-topology.js';
import type {
	ComputeExternalProvider,
	ComputeResourceDescriptor,
	ComputeResourceMap
} from '../types.js';

export interface ComputeResourceResolutionStats {
	readonly planBuilds: number;
	readonly entriesAllocated: number;
	readonly readsAllocated: number;
	readonly writesAllocated: number;
	readonly layoutEntriesAllocated: number;
	readonly topologyKeysAllocated: number;
	readonly steadyStateHits: number;
	readonly passEvictions: number;
}

interface MutableResolutionStats {
	planBuilds: number;
	entriesAllocated: number;
	readsAllocated: number;
	writesAllocated: number;
	layoutEntriesAllocated: number;
	topologyKeysAllocated: number;
	steadyStateHits: number;
	passEvictions: number;
}

interface ComputePassResolutionCacheEntry {
	topology: ComputePassStaticTopology;
	physicalReferences: readonly unknown[];
	resources: ResolvedComputePassResources;
	externalRegistrations: readonly ComputeExternalRegistration[];
}

function externalProviderError(
	context: ComputeResourceResolverContext,
	alias: string,
	error: unknown
): Error {
	const detail = error instanceof Error ? `: ${error.message}` : '.';
	const result = createSpektralError(
		'COMPUTE_EXTERNAL_RESOURCE_INVALID',
		`${context.passLabel} resource "${alias}" external provider failed${detail}`,
		{ cause: error }
	);
	return context.diagnosticContext
		? attachSpektralErrorContext(result, context.diagnosticContext)
		: result;
}

function resolveProviderForFrame<T extends object>(
	provider: ComputeExternalProvider<T>,
	context: ComputeResourceResolverContext,
	alias: string,
	state: ComputeExternalResolutionState
): T {
	if (typeof provider !== 'function') return provider;
	const cached = state.providerResults.get(provider);
	if (cached) return cached as T;
	let result: T;
	try {
		result = provider(context.externalContext);
	} catch (error) {
		throw externalProviderError(context, alias, error);
	}
	if (typeof result !== 'object' || result === null) {
		throw externalProviderError(
			context,
			alias,
			new Error('external provider returned an invalid WebGPU object')
		);
	}
	state.providerResults.set(provider, result);
	return result;
}

function visitDescriptorPhysicalReferences(
	descriptor: ComputeResourceDescriptor,
	alias: string,
	context: ComputeResourceResolverContext,
	state: ComputeExternalResolutionState,
	visit: (value: unknown) => void
): void {
	if ('texture' in descriptor) {
		if (typeof descriptor.texture === 'string') {
			const resource = context.getMaterialTexture(descriptor.texture);
			visit(resource?.ownedTexture ?? resource?.publishedView);
			// Ping-pong bindings are replaced by the renderer for every iteration.
			// Publishing the latest read view therefore changes frame state, not the
			// device/material resolution plan.
			if (descriptor.pingPong === undefined) {
				visit(resource?.publishedView);
				visit(resource?.storageView);
			}
			visit(resource?.format);
			visit(resource?.usage);
			visit(resource?.mipLevelCount);
			visit(resource?.width);
			visit(resource?.height);
			return;
		}
		if ('externalTexture' in descriptor.texture) {
			visit(resolveProviderForFrame(descriptor.texture.externalTexture, context, alias, state));
			return;
		}
		visit(resolveProviderForFrame(descriptor.texture.externalView, context, alias, state));
		return;
	}

	if ('buffer' in descriptor) {
		if (typeof descriptor.buffer === 'string') {
			const resource = context.getMaterialStorageBuffer(descriptor.buffer);
			visit(resource?.buffer);
			visit(resource?.size);
			visit(resource?.wgslType);
			visit(resource?.usage);
			visit(resource?.access);
			return;
		}
		visit(resolveProviderForFrame(descriptor.buffer.externalBuffer, context, alias, state));
		return;
	}

	if (typeof descriptor.sampler === 'string') {
		const resource = context.getMaterialSampler(descriptor.sampler);
		visit(resource?.sampler);
		visit(resource?.type);
		visit(resource?.sampleType);
		return;
	}
	visit(resolveProviderForFrame(descriptor.sampler.externalSampler, context, alias, state));
}

function visitTopologyPhysicalReferences(
	topology: ComputePassStaticTopology,
	context: ComputeResourceResolverContext,
	state: ComputeExternalResolutionState,
	visit: (value: unknown) => void
): void {
	for (const alias of topology.aliases) {
		const descriptor = topology.resources[alias];
		if (descriptor) visitDescriptorPhysicalReferences(descriptor, alias, context, state, visit);
	}
}

function matchesPhysicalReferences(
	topology: ComputePassStaticTopology,
	context: ComputeResourceResolverContext,
	state: ComputeExternalResolutionState,
	references: readonly unknown[]
): boolean {
	let index = 0;
	let matches = true;
	visitTopologyPhysicalReferences(topology, context, state, (value) => {
		if (!Object.is(references[index], value)) matches = false;
		index += 1;
	});
	return matches && index === references.length;
}

function collectPhysicalReferences(
	topology: ComputePassStaticTopology,
	context: ComputeResourceResolverContext,
	state: ComputeExternalResolutionState
): readonly unknown[] {
	const references: unknown[] = [];
	visitTopologyPhysicalReferences(topology, context, state, (value) => references.push(value));
	return Object.freeze(references);
}

function resetExternalResolutionState(state: ComputeExternalResolutionState): void {
	state.providerResults.clear();
	state.resourceIdByObject.clear();
	state.metadataByResourceId.clear();
	state.textureByResourceId.clear();
	state.bufferByResourceId.clear();
	state.samplerByResourceId.clear();
}

/** Renderer-owned layered resolver: pass topology -> device/material plan -> frame bindings. */
export class ComputePassResourceResolutionCache {
	private readonly entries = new Map<object, ComputePassResolutionCacheEntry>();
	private readonly externalState = createComputeExternalResolutionState();
	private readonly stats: MutableResolutionStats = {
		planBuilds: 0,
		entriesAllocated: 0,
		readsAllocated: 0,
		writesAllocated: 0,
		layoutEntriesAllocated: 0,
		topologyKeysAllocated: 0,
		steadyStateHits: 0,
		passEvictions: 0
	};

	beginFrame(): ComputeExternalResolutionState {
		resetExternalResolutionState(this.externalState);
		return this.externalState;
	}

	resolve(input: {
		pass: object;
		context: Omit<ComputeResourceResolverContext, 'externalState'>;
		pingPong: boolean;
	}): ResolvedComputePassResources {
		const topology = getComputePassStaticTopology(input.pass);
		const context: ComputeResourceResolverContext = {
			...input.context,
			externalState: this.externalState,
			...(input.pingPong ? { pingPong: true } : {})
		};
		const cached = this.entries.get(input.pass);
		if (
			cached?.topology === topology &&
			matchesPhysicalReferences(topology, context, this.externalState, cached.physicalReferences)
		) {
			for (const registration of cached.externalRegistrations) {
				registerComputeExternalResource(registration, context, this.externalState);
			}
			this.stats.steadyStateHits += 1;
			return cached.resources;
		}

		const resources = resolveTrustedComputePassResources(
			topology.resources,
			topology.aliases,
			context
		);
		const physicalReferences = collectPhysicalReferences(topology, context, this.externalState);
		const externalRegistrations: ComputeExternalRegistration[] = [];
		for (const entry of resources.entries) {
			if (entry.source !== 'external') continue;
			const descriptor = topology.resources[entry.alias]!;
			const kind =
				'buffer' in descriptor
					? 'buffer'
					: 'sampler' in descriptor
						? 'sampler'
						: typeof descriptor.texture !== 'string' && 'externalTexture' in descriptor.texture
							? 'texture'
							: undefined;
			externalRegistrations.push({
				object: entry.physicalId as object,
				resourceId: entry.logicalId,
				alias: entry.alias,
				metadata: this.externalState.metadataByResourceId.get(entry.logicalId)!,
				kind
			});
		}
		this.entries.set(input.pass, {
			topology,
			physicalReferences,
			resources,
			externalRegistrations
		});
		this.stats.planBuilds += 1;
		this.stats.entriesAllocated += resources.entries.length;
		this.stats.readsAllocated += resources.reads.length;
		this.stats.writesAllocated += resources.writes.length;
		this.stats.layoutEntriesAllocated += resources.entries.length;
		this.stats.topologyKeysAllocated += 1;
		return resources;
	}

	delete(pass: object): void {
		if (this.entries.delete(pass)) this.stats.passEvictions += 1;
	}

	clear(): void {
		this.entries.clear();
		resetExternalResolutionState(this.externalState);
	}

	getStats(): ComputeResourceResolutionStats {
		return Object.freeze({ ...this.stats });
	}
}

/** Benchmark/test entry point for identical static-topology inputs. */
export function createComputePassResourceResolutionCache(): ComputePassResourceResolutionCache {
	return new ComputePassResourceResolutionCache();
}

/** Benchmark-only helper keeps the legacy baseline explicit and isolated. */
export function resolveLegacyComputePassResources(
	resources: ComputeResourceMap,
	context: ComputeResourceResolverContext
): ResolvedComputePassResources {
	return resolveComputePassResources(resources, context);
}
