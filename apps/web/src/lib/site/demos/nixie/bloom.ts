import {
	ShaderPass,
	type RenderPass,
	type RenderPassContext,
	type RenderTargetDefinitionMap
} from 'spektral';

const extract = `
fn shade(inputColor: vec4f, uv: vec2f) -> vec4f {
	let color = max(inputColor.rgb, vec3f(0.0));
	let peak = max(color.r, max(color.g, color.b));
	let knee = clamp(peak - 0.55, 0.0, 0.9);
	let contribution = max(peak - 1.0, knee * knee / 1.8);
	return vec4f(color * contribution / max(peak, 0.0001), 1.0);
}
`;

// ShaderPass provides these input bindings; the offsets use the sampled target's dimensions.
const gaussian = (axis: 'horizontal' | 'vertical') => `
fn shade(inputColor: vec4f, uv: vec2f) -> vec4f {
	let size = vec2f(textureDimensions(spektralShaderPassTexture));
	let step = ${axis === 'horizontal' ? 'vec2f(2.0 / size.x, 0.0)' : 'vec2f(0.0, 1.0 / size.y)'};
	let texUv = vec2f(uv.x, 1.0 - uv.y);
	var color = inputColor.rgb * 0.2270270270;
	color += textureSample(spektralShaderPassTexture, spektralShaderPassSampler, texUv + step * 1.3846153846).rgb * 0.3162162162;
	color += textureSample(spektralShaderPassTexture, spektralShaderPassSampler, texUv - step * 1.3846153846).rgb * 0.3162162162;
	color += textureSample(spektralShaderPassTexture, spektralShaderPassSampler, texUv + step * 3.2307692308).rgb * 0.0702702703;
	color += textureSample(spektralShaderPassTexture, spektralShaderPassSampler, texUv - step * 3.2307692308).rgb * 0.0702702703;
	return vec4f(color, 1.0);
}
`;

/** A public RenderPass can sample the preserved scene and a named target together. */
export function createBloomComposite(bloomTarget: string, strength = 0.2): RenderPass {
	let device: GPUDevice | undefined;
	let format: GPUTextureFormat | undefined;
	let pipeline: GPURenderPipeline | undefined;
	let sampler: GPUSampler | undefined;
	let bindGroup: GPUBindGroup | undefined;
	let sceneView: GPUTextureView | undefined;
	let bloomView: GPUTextureView | undefined;
	const shader = `
struct VertexOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@group(0) @binding(0) var linearSampler: sampler;
@group(0) @binding(1) var sceneTexture: texture_2d<f32>;
@group(0) @binding(2) var bloomTexture: texture_2d<f32>;
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOut {
	var positions = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(-1.0, 1.0), vec2f(3.0, 1.0));
	let position = positions[index];
	var out: VertexOut;
	out.position = vec4f(position, 0.0, 1.0);
	out.uv = vec2f(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
	return out;
}
@fragment fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
	let scene = textureSample(sceneTexture, linearSampler, input.uv);
	let bloom = textureSample(bloomTexture, linearSampler, input.uv).rgb;
	return vec4f(scene.rgb + bloom * ${strength.toFixed(6)}, scene.a);
}
`;
	const forgetViews = () => {
		bindGroup = undefined;
		sceneView = undefined;
		bloomView = undefined;
	};
	return {
		label: 'Nixie bloom composite',
		input: 'source',
		output: 'target',
		needsSwap: true,
		clear: true,
		preserve: true,
		setSize: forgetViews,
		render(context: RenderPassContext) {
			const bloom = context.targets[bloomTarget];
			if (!bloom) throw new Error(`Bloom target '${bloomTarget}' is not declared.`);
			if (device !== context.device || format !== context.output.format) {
				device = context.device;
				format = context.output.format;
				const module = device.createShaderModule({ label: 'Nixie bloom composite', code: shader });
				pipeline = device.createRenderPipeline({
					label: 'Nixie bloom composite',
					layout: 'auto',
					vertex: { module, entryPoint: 'vertexMain' },
					fragment: { module, entryPoint: 'fragmentMain', targets: [{ format }] },
					primitive: { topology: 'triangle-list' }
				});
				sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
				forgetViews();
			}
			if (!bindGroup || sceneView !== context.input.view || bloomView !== bloom.view) {
				sceneView = context.input.view;
				bloomView = bloom.view;
				bindGroup = context.device.createBindGroup({
					label: 'Nixie scene and bloom',
					layout: pipeline!.getBindGroupLayout(0),
					entries: [
						{ binding: 0, resource: sampler! },
						{ binding: 1, resource: sceneView },
						{ binding: 2, resource: bloomView }
					]
				});
			}
			const pass = context.beginRenderPass();
			pass.setPipeline(pipeline!);
			pass.setBindGroup(0, bindGroup);
			pass.draw(3);
			pass.end();
		},
		dispose() {
			// Target textures belong to Spektral; this pass only releases its own GPU references.
			forgetViews();
			device = undefined;
			format = undefined;
			pipeline = undefined;
			sampler = undefined;
		}
	};
}

export function createNixieBloom() {
	const renderTargets = {
		nixieBloomHalf: { scale: 0.5, format: 'rgba16float' },
		nixieBloomQuarter: { scale: 0.25, format: 'rgba16float' },
		nixieBloomBlur: { scale: 0.25, format: 'rgba16float' }
	} satisfies RenderTargetDefinitionMap;
	const passes: RenderPass[] = [
		new ShaderPass({
			label: 'Nixie HDR extraction',
			fragment: extract,
			input: 'source',
			output: 'nixieBloomHalf',
			needsSwap: false
		}),
		new ShaderPass({
			label: 'Nixie horizontal bloom',
			fragment: gaussian('horizontal'),
			input: 'nixieBloomHalf',
			output: 'nixieBloomQuarter',
			needsSwap: false
		}),
		new ShaderPass({
			label: 'Nixie vertical bloom',
			fragment: gaussian('vertical'),
			input: 'nixieBloomQuarter',
			output: 'nixieBloomBlur',
			needsSwap: false
		}),
		createBloomComposite('nixieBloomBlur')
	];
	return { renderTargets, passes };
}
