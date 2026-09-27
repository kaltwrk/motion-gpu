import { describe, expect, it } from 'vitest';
import {
	attachShaderCompilationDiagnostics,
	type ShaderCompilationDiagnosticsPayload
} from '../../lib/core/error-diagnostics';
import {
	attachSpektralErrorContext,
	createSpektralError,
	toSpektralErrorReport,
	type SpektralErrorCode
} from '../../lib/core/error-report';

describe('error report', () => {
	it('maps every explicit compute-resource diagnostic code and preserves runtime context', () => {
		const codes: SpektralErrorCode[] = [
			'COMPUTE_RESOURCE_DESCRIPTOR_INVALID',
			'COMPUTE_RESOURCE_UNKNOWN',
			'COMPUTE_RESOURCE_INCOMPATIBLE',
			'COMPUTE_RESOURCE_ALIAS_COLLISION',
			'COMPUTE_RESOURCE_HAZARD',
			'COMPUTE_GRAPH_MULTIPLE_WRITERS',
			'COMPUTE_GRAPH_CYCLE',
			'COMPUTE_RESOURCE_LIMIT_EXCEEDED',
			'COMPUTE_EXTERNAL_RESOURCE_INVALID'
		];
		for (const code of codes) {
			const error = attachSpektralErrorContext(createSpektralError(code, `failure: ${code}`), {
				materialSignature: 'material-signature',
				passGraph: { passCount: 2, enabledPassCount: 2, inputs: [], outputs: [] },
				activeRenderTargets: ['fxMain']
			});
			const report = toSpektralErrorReport(error, 'render');
			expect(report.code).toBe(code);
			expect(report.title).not.toBe('Spektral render error');
			expect(report.hint.length).toBeGreaterThan(20);
			expect(report.context?.materialSignature).toBe('material-signature');
		}
	});

	it('preserves an explicit diagnostic code without a dedicated title mapping', () => {
		const report = toSpektralErrorReport(
			createSpektralError('RENDER_GRAPH_INVALID', 'An opaque failure occurred.'),
			'render'
		);
		expect(report.code).toBe('RENDER_GRAPH_INVALID');
	});

	it('classifies WebGPU unavailable errors', () => {
		const report = toSpektralErrorReport(
			new Error('WebGPU is not available in this browser'),
			'initialization'
		);

		expect(report.title).toBe('WebGPU unavailable');
		expect(report.code).toBe('WEBGPU_UNAVAILABLE');
		expect(report.severity).toBe('fatal');
		expect(report.recoverable).toBe(false);
		expect(report.hint).toContain('WebGPU enabled');
		expect(report.message).toBe('WebGPU is not available in this browser');
	});

	it('extracts WGSL details lines', () => {
		const report = toSpektralErrorReport(
			new Error(
				[
					'WGSL compilation failed:',
					'line 9: identifiers must not start with two or more underscores',
					"line 12: expected ';'"
				].join('\n')
			),
			'render'
		);

		expect(report.title).toBe('WGSL compilation failed');
		expect(report.code).toBe('WGSL_COMPILATION_FAILED');
		expect(report.severity).toBe('error');
		expect(report.recoverable).toBe(true);
		expect(report.details).toEqual([
			'line 9: identifiers must not start with two or more underscores',
			"line 12: expected ';'"
		]);
	});

	it('builds source snippet from structured shader diagnostics', () => {
		const error = attachShaderCompilationDiagnostics(
			new Error('WGSL compilation failed:\nmissing return at end of function'),
			{
				kind: 'shader-compilation',
				diagnostics: [
					{
						generatedLine: 112,
						message: 'missing return at end of function',
						linePos: 5,
						lineLength: 6,
						sourceLocation: { kind: 'fragment', line: 3 }
					}
				],
				fragmentSource: ['fn frag(uv: vec2f) -> vec4f {', '\tlet x = uv.x;', '\tuv.x;', '}'].join(
					'\n'
				),
				includeSources: {},
				materialSource: { component: 'GlassPaneScene.svelte' }
			}
		);

		const report = toSpektralErrorReport(error, 'render');
		expect(report.message).toBe(
			'[fragment line 3 | generated WGSL line 112] missing return at end of function'
		);
		expect(report.source).not.toBeNull();
		expect(report.source?.location).toContain('GlassPaneScene.svelte');
		expect(report.source?.location).toContain('fragment line 3');
		expect(report.source?.line).toBe(3);
		expect(report.source?.snippet.some((line) => line.highlight && line.number === 3)).toBe(true);
	});

	it('keeps the message, source and shader metadata on the same first diagnostic', () => {
		const error = attachShaderCompilationDiagnostics(new Error('WGSL compilation failed'), {
			kind: 'shader-compilation',
			diagnostics: [
				{
					generatedLine: 0,
					message: 'first error without a source location',
					sourceLocation: null
				},
				{
					generatedLine: 112,
					message: 'second error with a source location',
					linePos: 5,
					sourceLocation: { kind: 'fragment', line: 3 }
				}
			],
			fragmentSource: 'fn frag(uv: vec2f) -> vec4f {}',
			includeSources: {},
			materialSource: null
		});

		const report = toSpektralErrorReport(error, 'render');
		expect(report.message).toBe('first error without a source location');
		expect(report.source).toBeNull();
		expect(report.shader).toEqual({ stage: 'fragment', sourceKind: 'wrapper' });
		expect(report.details).toEqual([
			'[fragment line 3 | generated WGSL line 112] second error with a source location'
		]);
	});

	it('builds include source snippet when diagnostics point to include chunk', () => {
		const error = attachShaderCompilationDiagnostics(
			new Error('WGSL compilation failed:\nunknown function call'),
			{
				kind: 'shader-compilation',
				diagnostics: [
					{
						generatedLine: 25,
						message: 'unknown function call',
						linePos: 4,
						lineLength: 8,
						sourceLocation: { kind: 'include', include: 'tone', line: 2 }
					}
				],
				fragmentSource: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
				includeSources: {
					tone: ['fn tone(uv: vec2f) -> vec3f {', '\treturn vec3f(uv, 1.0);', '}'].join('\n')
				},
				materialSource: null
			}
		);

		const report = toSpektralErrorReport(error, 'render');
		expect(report.message).toBe(
			'[include <tone> line 2 | generated WGSL line 25] unknown function call'
		);
		expect(report.source?.component).toBe('#include <tone>');
		expect(report.source?.location).toContain('include <tone> line 2');
		expect(report.source?.line).toBe(2);
		expect(report.source?.snippet.some((line) => line.highlight && line.number === 2)).toBe(true);
	});

	it('builds define source snippet when diagnostics point to define block', () => {
		const error = attachShaderCompilationDiagnostics(
			new Error('WGSL compilation failed:\ninvalid const literal'),
			{
				kind: 'shader-compilation',
				diagnostics: [
					{
						generatedLine: 2,
						message: 'invalid const literal',
						linePos: 3,
						lineLength: 5,
						sourceLocation: { kind: 'define', define: 'USE_GLOW', line: 2 }
					}
				],
				fragmentSource: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
				includeSources: {},
				defineBlockSource: ['const ENABLE_FX: bool = true;', 'const USE_GLOW: f32 = bad;'].join(
					'\n'
				),
				materialSource: null
			}
		);

		const report = toSpektralErrorReport(error, 'render');
		expect(report.message).toBe(
			'[define "USE_GLOW" line 2 | generated WGSL line 2] invalid const literal'
		);
		expect(report.source?.component).toBe('#define USE_GLOW');
		expect(report.source?.location).toContain('define "USE_GLOW" line 2');
		expect(report.source?.line).toBe(2);
		expect(report.source?.snippet.some((line) => line.highlight && line.number === 2)).toBe(true);
	});

	it('passes through shader runtime context metadata from diagnostics payload', () => {
		const error = attachShaderCompilationDiagnostics(
			new Error('WGSL compilation failed:\nunknown function call'),
			{
				kind: 'shader-compilation',
				diagnostics: [
					{
						generatedLine: 14,
						message: 'unknown function call',
						sourceLocation: { kind: 'fragment', line: 1 }
					}
				],
				fragmentSource: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
				includeSources: {},
				materialSource: null,
				runtimeContext: {
					materialSignature: '{"fragment":"hash"}',
					passGraph: {
						passCount: 2,
						enabledPassCount: 1,
						inputs: ['source'],
						outputs: ['target']
					},
					activeRenderTargets: ['fxMain']
				}
			}
		);

		const report = toSpektralErrorReport(error, 'render');
		expect(report.context).toEqual({
			materialSignature: '{"fragment":"hash"}',
			passGraph: {
				passCount: 2,
				enabledPassCount: 1,
				inputs: ['source'],
				outputs: ['target']
			},
			activeRenderTargets: ['fxMain']
		});
	});

	it('clones and deeply freezes reports without freezing diagnostic inputs', () => {
		const diagnostic = {
			generatedLine: 4,
			message: 'invalid expression',
			sourceLocation: { kind: 'fragment' as const, line: 2 }
		};
		const diagnostics = [diagnostic];
		const diagnosticContext = {
			materialSignature: 'mutable-input',
			passGraph: {
				passCount: 1,
				enabledPassCount: 1,
				inputs: ['source'],
				outputs: ['canvas']
			},
			activeRenderTargets: ['canvas']
		};
		const payload = {
			kind: 'shader-compilation' as const,
			diagnostics,
			fragmentSource: ['fn frag() -> vec4f {', '\tbad;', '}'].join('\n'),
			includeSources: {},
			materialSource: null,
			runtimeContext: diagnosticContext
		} satisfies ShaderCompilationDiagnosticsPayload;
		const error = attachShaderCompilationDiagnostics(
			new Error('WGSL compilation failed:\ninvalid expression'),
			payload
		);
		const report = toSpektralErrorReport(error, 'render');

		expect(Object.isFrozen(report)).toBe(true);
		expect(Object.isFrozen(report.details)).toBe(true);
		expect(Object.isFrozen(report.stack)).toBe(true);
		expect(Object.isFrozen(report.source)).toBe(true);
		expect(Object.isFrozen(report.source?.snippet)).toBe(true);
		expect(report.source?.snippet.every((line) => Object.isFrozen(line))).toBe(true);
		expect(Object.isFrozen(report.context)).toBe(true);
		expect(Object.isFrozen(report.context?.activeRenderTargets)).toBe(true);
		expect(Object.isFrozen(report.context?.passGraph)).toBe(true);
		expect(Object.isFrozen(report.context?.passGraph?.inputs)).toBe(true);
		expect(Object.isFrozen(report.context?.passGraph?.outputs)).toBe(true);

		expect(Object.isFrozen(payload)).toBe(false);
		expect(Object.isFrozen(diagnostics)).toBe(false);
		expect(Object.isFrozen(diagnostic)).toBe(false);
		expect(Object.isFrozen(diagnosticContext)).toBe(false);
		expect(Object.isFrozen(diagnosticContext.passGraph)).toBe(false);
		expect(Object.isFrozen(diagnosticContext.passGraph.inputs)).toBe(false);

		diagnosticContext.passGraph.inputs.push('late-input');
		diagnosticContext.activeRenderTargets.push('late-target');
		diagnostic.message = 'mutated after normalization';

		expect(report.context?.passGraph?.inputs).toEqual(['source']);
		expect(report.context?.activeRenderTargets).toEqual(['canvas']);
		expect(report.message).toContain('invalid expression');
	});

	it('uses material source filename when component name is unavailable', () => {
		const error = attachShaderCompilationDiagnostics(
			new Error('WGSL compilation failed:\nbad expression'),
			{
				kind: 'shader-compilation',
				diagnostics: [
					{
						generatedLine: 10,
						message: 'bad expression',
						sourceLocation: { kind: 'fragment', line: 1 }
					}
				],
				fragmentSource: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
				includeSources: {},
				materialSource: { file: '/app/components/Water.svelte' }
			}
		);

		const report = toSpektralErrorReport(error, 'render');
		expect(report.source?.component).toBe('Water.svelte');
		expect(report.source?.location).toContain('Water.svelte');
	});

	it('classifies device lost errors', () => {
		const report = toSpektralErrorReport(
			new Error('WebGPU device lost: The device was lost (unknown)'),
			'render'
		);

		expect(report.title).toBe('WebGPU device lost');
		expect(report.code).toBe('WEBGPU_DEVICE_LOST');
		expect(report.severity).toBe('fatal');
		expect(report.recoverable).toBe(false);
		expect(report.hint).toContain('Recreate the renderer');
	});

	it('classifies uncaptured GPU errors', () => {
		const report = toSpektralErrorReport(
			new Error('WebGPU uncaptured error: validation failed'),
			'render'
		);

		expect(report.title).toBe('WebGPU uncaptured error');
		expect(report.code).toBe('WEBGPU_UNCAPTURED_ERROR');
		expect(report.severity).toBe('error');
		expect(report.recoverable).toBe(true);
		expect(report.hint).toContain('GPU command failed asynchronously');
	});

	it('classifies compute dispatch limit violations with targeted hint', () => {
		const report = toSpektralErrorReport(
			new Error(
				'WebGPU uncaptured error: Dispatch workgroup count X (66317) exceeds max compute workgroups per dimension (65535).'
			),
			'render'
		);

		expect(report.title).toBe('Compute dispatch exceeds device limit');
		expect(report.code).toBe('WEBGPU_UNCAPTURED_ERROR');
		expect(report.hint).toContain('split compute work');
	});

	it('classifies storage buffer binding size violations with targeted hint', () => {
		const report = toSpektralErrorReport(
			new Error(
				'WebGPU uncaptured error: Binding size (134222400) of [Buffer (unlabeled)] is larger than the maximum storage buffer binding size (134217728).'
			),
			'render'
		);

		expect(report.title).toBe('Storage buffer exceeds binding limit');
		expect(report.code).toBe('WEBGPU_UNCAPTURED_ERROR');
		expect(report.hint).toContain('shard data');
	});

	it('classifies adapter unavailable errors', () => {
		const report = toSpektralErrorReport(new Error('Unable to acquire WebGPU adapter'), 'render');
		expect(report.title).toBe('WebGPU adapter unavailable');
		expect(report.code).toBe('WEBGPU_ADAPTER_UNAVAILABLE');
		expect(report.severity).toBe('fatal');
		expect(report.recoverable).toBe(false);
		expect(report.hint).toContain('adapter request failed');
	});

	it('classifies canvas context errors', () => {
		const report = toSpektralErrorReport(
			new Error('Canvas does not support webgpu context'),
			'initialization'
		);
		expect(report.title).toBe('Canvas cannot create WebGPU context');
		expect(report.code).toBe('WEBGPU_CONTEXT_UNAVAILABLE');
		expect(report.severity).toBe('error');
		expect(report.recoverable).toBe(true);
		expect(report.hint).toContain('canvas is attached to DOM');
	});

	it('classifies copy-destination texture usage errors', () => {
		const report = toSpektralErrorReport(
			new Error('Destination texture needs to have CopyDst usage'),
			'render'
		);
		expect(report.title).toBe('Invalid texture usage flags');
		expect(report.code).toBe('TEXTURE_USAGE_INVALID');
		expect(report.severity).toBe('error');
		expect(report.recoverable).toBe(true);
		expect(report.hint).toContain('must include CopyDst');
	});

	it('classifies texture request failures', () => {
		const report = toSpektralErrorReport(
			new Error('Texture request failed (404) for /missing-texture.png'),
			'initialization'
		);
		expect(report.title).toBe('Texture request failed');
		expect(report.code).toBe('TEXTURE_REQUEST_FAILED');
		expect(report.severity).toBe('error');
		expect(report.recoverable).toBe(true);
	});

	it('classifies missing createImageBitmap runtime support', () => {
		const report = toSpektralErrorReport(
			new Error('createImageBitmap is not available in this runtime'),
			'initialization'
		);
		expect(report.title).toBe('Texture decode unavailable');
		expect(report.code).toBe('TEXTURE_DECODE_UNAVAILABLE');
		expect(report.severity).toBe('fatal');
		expect(report.recoverable).toBe(false);
	});

	it('classifies aborted texture requests', () => {
		const report = toSpektralErrorReport(
			new Error('Texture request was aborted'),
			'initialization'
		);
		expect(report.title).toBe('Texture request aborted');
		expect(report.code).toBe('TEXTURE_REQUEST_ABORTED');
		expect(report.severity).toBe('error');
		expect(report.recoverable).toBe(true);
	});

	it('classifies bind group mismatch errors and removes duplicate stack message line', () => {
		const error = new Error('CreateBindGroup failed due to bind group layout mismatch');
		error.stack = [
			'Error: CreateBindGroup failed due to bind group layout mismatch',
			'CreateBindGroup failed due to bind group layout mismatch',
			'at render (Renderer.ts:42:7)'
		].join('\n');

		const report = toSpektralErrorReport(error, 'render');
		expect(report.title).toBe('Bind group mismatch');
		expect(report.code).toBe('BIND_GROUP_MISMATCH');
		expect(report.severity).toBe('error');
		expect(report.recoverable).toBe(true);
		expect(report.stack).toEqual([
			'Error: CreateBindGroup failed due to bind group layout mismatch',
			'at render (Renderer.ts:42:7)'
		]);
	});

	it('handles unknown non-error values', () => {
		const report = toSpektralErrorReport({ broken: true }, 'render');
		expect(report.title).toBe('Spektral render error');
		expect(report.code).toBe('SPEKTRAL_RUNTIME_ERROR');
		expect(report.severity).toBe('error');
		expect(report.recoverable).toBe(true);
		expect(report.message).toBe('Unknown FragCanvas error');
		expect(report.phase).toBe('render');
	});

	it('normalizes string-thrown values into report message and rawMessage', () => {
		const report = toSpektralErrorReport('raw string failure', 'render');
		expect(report.rawMessage).toBe('raw string failure');
		expect(report.message).toBe('raw string failure');
		expect(report.details).toEqual([]);
		expect(report.phase).toBe('render');
	});

	// --- Compute error tests ---

	it('classifies compute compilation errors with correct code', () => {
		const report = toSpektralErrorReport(
			new Error('Compute shader compilation failed: invalid entry point'),
			'render'
		);
		expect(report.title).toBe('Compute shader compilation failed');
		expect(report.code).toBe('COMPUTE_COMPILATION_FAILED');
		expect(report.severity).toBe('error');
		expect(report.hint).toContain('storage bindings');
	});

	it('compute compilation error is recoverable', () => {
		const report = toSpektralErrorReport(
			new Error('Compute shader compilation failed: bad workgroup_size'),
			'render'
		);
		expect(report.recoverable).toBe(true);
	});

	it('classifies material preprocess failures from unknown includes', () => {
		const report = toSpektralErrorReport(
			new Error('Unknown include "tone" referenced in fragment shader.'),
			'initialization'
		);

		expect(report.title).toBe('Material preprocess failed');
		expect(report.code).toBe('MATERIAL_PREPROCESS_FAILED');
		expect(report.severity).toBe('error');
		expect(report.recoverable).toBe(true);
	});

	it('classifies missing runtime bindings from unknown uniforms/textures/storage resources', () => {
		const report = toSpektralErrorReport(
			new Error('Unknown uniform "uGain". Declare it in material.uniforms first.'),
			'render'
		);

		expect(report.title).toBe('Runtime resource binding failed');
		expect(report.code).toBe('RUNTIME_RESOURCE_MISSING');
		expect(report.severity).toBe('error');
		expect(report.recoverable).toBe(true);
	});

	it('classifies storage buffer writes that exceed declared bounds', () => {
		const report = toSpektralErrorReport(
			new Error(
				'Storage buffer "particles" write out of bounds: offset=64, dataSize=256, bufferSize=128.'
			),
			'render'
		);

		expect(report.title).toBe('Storage buffer write out of bounds');
		expect(report.code).toBe('STORAGE_BUFFER_OUT_OF_BOUNDS');
		expect(report.severity).toBe('error');
		expect(report.recoverable).toBe(true);
	});

	it('classifies storage buffer read failures', () => {
		const report = toSpektralErrorReport(
			new Error('Cannot read storage buffer "particles": renderer not initialized.'),
			'render'
		);

		expect(report.title).toBe('Storage buffer read failed');
		expect(report.code).toBe('STORAGE_BUFFER_READ_FAILED');
		expect(report.severity).toBe('error');
		expect(report.recoverable).toBe(true);
	});

	it('classifies invalid render graph configurations', () => {
		const report = toSpektralErrorReport(
			new Error('Render pass #2 reads "target" before it is written.'),
			'initialization'
		);

		expect(report.title).toBe('Render graph configuration is invalid');
		expect(report.code).toBe('RENDER_GRAPH_INVALID');
		expect(report.severity).toBe('error');
		expect(report.recoverable).toBe(true);
	});

	it('classifies ping-pong pass misconfiguration', () => {
		const report = toSpektralErrorReport(
			new Error('PingPongComputePass must provide a target texture key.'),
			'render'
		);

		expect(report.title).toBe('Ping-pong compute pass is misconfigured');
		expect(report.code).toBe('PINGPONG_CONFIGURATION_INVALID');
		expect(report.severity).toBe('error');
		expect(report.recoverable).toBe(true);
	});

	it('classifies ping-pong shader pass misconfiguration', () => {
		const report = toSpektralErrorReport(
			new Error('PingPongShaderPass target "fluid" must reference a declared material texture.'),
			'render'
		);

		expect(report.title).toBe('Ping-pong shader pass is misconfigured');
		expect(report.code).toBe('PINGPONG_CONFIGURATION_INVALID');
		expect(report.severity).toBe('error');
		expect(report.recoverable).toBe(true);
	});

	it('classifies compute contract errors from invalid WGSL entrypoint requirements', () => {
		const report = toSpektralErrorReport(
			new Error('Compute shader must include a `@builtin(global_invocation_id)` parameter.'),
			'initialization'
		);

		expect(report.title).toBe('Compute contract is invalid');
		expect(report.code).toBe('COMPUTE_CONTRACT_INVALID');
		expect(report.severity).toBe('error');
		expect(report.recoverable).toBe(true);
	});

	it('classifies invalid uniform value payloads', () => {
		const report = toSpektralErrorReport(
			new Error('Uniform vec3f value must be a tuple with 3 numbers'),
			'render'
		);

		expect(report.title).toBe('Uniform value is invalid');
		expect(report.code).toBe('UNIFORM_VALUE_INVALID');
		expect(report.severity).toBe('error');
		expect(report.recoverable).toBe(true);
	});
});
