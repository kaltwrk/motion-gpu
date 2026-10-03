import type { Attachment } from 'svelte/attachments';
import fragmentSource from './glass.frag?raw';

const vertexSource = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = (position + 1.0) * 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

/** The previous landing's GlassPaneScene, reduced to its static gradient mode. */
export const glassGradient: Attachment<HTMLCanvasElement> = (canvas) => {
	const gl = canvas.getContext('webgl', { alpha: false, antialias: false });
	if (!gl) return;

	const shaders: WebGLShader[] = [];
	const program = gl.createProgram();
	const buffer = gl.createBuffer();
	const texture = gl.createTexture();
	const dispose = () => {
		gl.deleteBuffer(buffer);
		gl.deleteTexture(texture);
		gl.deleteProgram(program);
		for (const shader of shaders) gl.deleteShader(shader);
	};

	for (const [type, source] of [
		[gl.VERTEX_SHADER, vertexSource],
		[gl.FRAGMENT_SHADER, fragmentSource]
	] as const) {
		const shader = gl.createShader(type);
		if (!shader) {
			dispose();
			return;
		}
		shaders.push(shader);
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			dispose();
			return;
		}
		gl.attachShader(program, shader);
	}
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		dispose();
		return;
	}
	gl.useProgram(program);
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
	const position = gl.getAttribLocation(program, 'position');
	gl.enableVertexAttribArray(position);
	gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texImage2D(
		gl.TEXTURE_2D,
		0,
		gl.RGBA,
		1,
		1,
		0,
		gl.RGBA,
		gl.UNSIGNED_BYTE,
		new Uint8Array([0, 0, 0, 255])
	);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

	const parameters = {
		uUseGradient: 1,
		uTime: 0,
		uRotation: 50,
		uRefraction: 1,
		uChromaticAberration: 0,
		uPanelWidth: 1,
		uWaveFrequency: 0,
		uWaveAmplitude: 0
	};
	for (const [name, value] of Object.entries(parameters)) {
		gl.uniform1f(gl.getUniformLocation(program, name), value);
	}
	gl.uniform2f(gl.getUniformLocation(program, 'uTextureSize'), 1, 1);
	const resolution = gl.getUniformLocation(program, 'uResolution');
	const background = gl.getUniformLocation(program, 'uGradientBackground');
	const accent = gl.getUniformLocation(program, 'uGradientAccent');

	// Canvas converts the app's OKLCH tokens to the shader's sRGB values.
	const probe = document.createElement('span');
	probe.hidden = true;
	canvas.parentElement?.append(probe);
	const colorCanvas = document.createElement('canvas');
	colorCanvas.width = colorCanvas.height = 1;
	const colorContext = colorCanvas.getContext('2d', { willReadFrequently: true });
	if (!colorContext) {
		probe.remove();
		dispose();
		return;
	}

	function setColor(location: WebGLUniformLocation | null, token: string) {
		if (!colorContext) return;
		probe.style.color = `var(${token})`;
		colorContext.fillStyle = getComputedStyle(probe).color;
		colorContext.fillRect(0, 0, 1, 1);
		const [r, g, b] = colorContext.getImageData(0, 0, 1, 1).data;
		gl?.uniform3f(location, r / 255, g / 255, b / 255);
	}

	function render() {
		if (!gl || gl.isContextLost()) return;
		const width = canvas.clientWidth;
		const height = canvas.clientHeight;
		if (!width || !height) return;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
		gl.viewport(0, 0, canvas.width, canvas.height);
		gl.uniform2f(resolution, width, height);
		setColor(background, '--background');
		setColor(accent, '--primary');
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	}

	const sizeObserver = new ResizeObserver(render);
	const themeObserver = new MutationObserver(render);
	sizeObserver.observe(canvas);
	themeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['class', 'style']
	});
	render();
	return () => {
		sizeObserver.disconnect();
		themeObserver.disconnect();
		probe.remove();
		dispose();
	};
};
