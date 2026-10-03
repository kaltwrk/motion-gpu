<script lang="ts">
	import { onMount } from 'svelte';
	import { useFrame, useSpektral, usePointer } from 'spektral/svelte';

	type Axis = 'x' | 'y' | 'z';
	type Layer = -1 | 0 | 1;
	type Direction = -1 | 1;
	type Vec3 = [number, number, number];
	type Quat = [number, number, number, number];

	type Move = {
		axis: Axis;
		layer: Layer;
		direction: Direction;
	};

	type Cubelet = {
		position: Vec3;
		quaternion: Quat;
	};

	const motion = useSpektral();

	const CUBE_COUNT = 27;
	const ENTRY_STRIDE = 4;
	const MOVE_DURATION = 1.15;
	const MOVE_DELAY = 0.35;
	const HALF_PI = Math.PI * 0.5;

	const DRAG_SENSITIVITY = 0.005;
	const DRAG_VELOCITY_SMOOTHING = 0.2;
	const ANGULAR_VELOCITY_SMOOTHING = 0.22;
	const MOMENTUM_DECAY = 3.25;
	const MOMENTUM_MIN_SPEED = 0.015;
	const MOMENTUM_MIN_ANGULAR_SPEED = 0.02;
	const AUTO_ROTATE_SPEED = 0.24;
	const BASE_CUBE_SCALE = 0.7;
	const BASE_CUBE_GAP = 0.05;
	const BASE_ROUND_RADIUS = 0.075;
	const REFERENCE_VIEWPORT = 900;

	const AXIS_VECTORS: Record<Axis, Vec3> = {
		x: [1, 0, 0],
		y: [0, 1, 0],
		z: [0, 0, 1]
	};

	const AXIS_INDEX: Record<Axis, 0 | 1 | 2> = {
		x: 0,
		y: 1,
		z: 2
	};

	const IDENTITY_QUAT: Quat = [0, 0, 0, 1];

	const POSSIBLE_MOVES: Move[] = (() => {
		const moves: Move[] = [];
		for (const axis of ['x', 'y', 'z'] as const) {
			for (const layer of [-1, 0, 1] as const) {
				for (const direction of [-1, 1] as const) {
					moves.push({ axis, layer, direction });
				}
			}
		}
		return moves;
	})();

	const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

	const initializeCubelets = (): Cubelet[] => {
		const cubelets: Cubelet[] = [];
		for (const x of [-1, 0, 1] as const) {
			for (const y of [-1, 0, 1] as const) {
				for (const z of [-1, 0, 1] as const) {
					cubelets.push({
						position: [x, y, z],
						quaternion: [0, 0, 0, 1]
					});
				}
			}
		}
		return cubelets;
	};

	const quatNormalize = (q: Quat): Quat => {
		const magnitude = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
		return [q[0] / magnitude, q[1] / magnitude, q[2] / magnitude, q[3] / magnitude];
	};

	const quatMultiply = (a: Quat, b: Quat): Quat =>
		quatNormalize([
			a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
			a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
			a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
			a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
		]);

	const quatFromAxisAngle = (axis: Vec3, angle: number): Quat => {
		const half = angle * 0.5;
		const s = Math.sin(half);
		return quatNormalize([axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)]);
	};

	const quatRotateVec = (q: Quat, v: Vec3): Vec3 => {
		const qx = q[0];
		const qy = q[1];
		const qz = q[2];
		const qw = q[3];

		const uvx = qy * v[2] - qz * v[1];
		const uvy = qz * v[0] - qx * v[2];
		const uvz = qx * v[1] - qy * v[0];

		const uuvx = qy * uvz - qz * uvy;
		const uuvy = qz * uvx - qx * uvz;
		const uuvz = qx * uvy - qy * uvx;

		return [
			v[0] + 2 * (qw * uvx + uuvx),
			v[1] + 2 * (qw * uvy + uuvy),
			v[2] + 2 * (qw * uvz + uuvz)
		];
	};

	const cubelets = initializeCubelets();
	const basePositionBuffer = new Float32Array(CUBE_COUNT * ENTRY_STRIDE);
	const baseQuaternionBuffer = new Float32Array(CUBE_COUNT * ENTRY_STRIDE);

	let currentMove: Move | null = null;
	let isAnimating = false;
	let moveProgress = 0;
	let currentMoveAngle = 0;
	let lastMoveAxis: Axis | null = null;
	let timeSinceLastMove = 0;

	let isDragging = false;
	let lastPointerTime = 0;
	let lastArcballVec: Vec3 | null = null;
	let sceneQuat: Quat = [0, 0, 0, 1];
	let dragVelocityY = 0;
	let dragVelocityX = 0;
	let dragAngularSpeed = 0;
	let dragAngularAxis: Vec3 = [0, 1, 0];
	let momentumVelocityY = 0;
	let momentumVelocityX = 0;
	let momentumAngularSpeed = 0;
	let momentumAngularAxis: Vec3 = [0, 1, 0];
	let baseBuffersDirty = true;

	const syncBaseBuffers = () => {
		for (let index = 0; index < CUBE_COUNT; index += 1) {
			const cubelet = cubelets[index];
			const base = index * ENTRY_STRIDE;

			basePositionBuffer[base] = cubelet.position[0];
			basePositionBuffer[base + 1] = cubelet.position[1];
			basePositionBuffer[base + 2] = cubelet.position[2];
			basePositionBuffer[base + 3] = 1;

			baseQuaternionBuffer[base] = cubelet.quaternion[0];
			baseQuaternionBuffer[base + 1] = cubelet.quaternion[1];
			baseQuaternionBuffer[base + 2] = cubelet.quaternion[2];
			baseQuaternionBuffer[base + 3] = cubelet.quaternion[3];
		}
	};

	syncBaseBuffers();

	const applyOrbitDelta = (horizontalDelta: number, verticalDelta: number) => {
		const angle = Math.hypot(horizontalDelta, verticalDelta);
		if (angle < 1e-6) return;

		const axis: Vec3 = [verticalDelta / angle, horizontalDelta / angle, 0];
		const qDelta = quatFromAxisAngle(axis, angle);
		sceneQuat = quatMultiply(qDelta, sceneQuat);
	};

	const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

	const normalizeVec3 = (v: Vec3): Vec3 => {
		const length = Math.hypot(v[0], v[1], v[2]) || 1;
		return [v[0] / length, v[1] / length, v[2] / length];
	};

	const crossVec3 = (a: Vec3, b: Vec3): Vec3 => [
		a[1] * b[2] - a[2] * b[1],
		a[2] * b[0] - a[0] * b[2],
		a[0] * b[1] - a[1] * b[0]
	];

	const dotVec3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

	const quatFromUnitVectors = (from: Vec3, to: Vec3): Quat => {
		const d = clamp(dotVec3(from, to), -1, 1);
		const cross = crossVec3(from, to);
		const crossLen = Math.hypot(cross[0], cross[1], cross[2]);

		if (crossLen < 1e-6 && d < -0.9999) {
			const fallback =
				Math.abs(from[0]) < 0.9 ? crossVec3(from, [1, 0, 0]) : crossVec3(from, [0, 1, 0]);
			const axis = normalizeVec3(fallback);
			return quatFromAxisAngle(axis, Math.PI);
		}

		return quatNormalize([cross[0], cross[1], cross[2], 1 + d]);
	};

	const projectPointerToArcball = (
		clientX: number,
		clientY: number,
		canvas: HTMLCanvasElement
	): Vec3 => {
		const rect = canvas.getBoundingClientRect();
		const width = Math.max(rect.width, 1);
		const height = Math.max(rect.height, 1);
		let x = ((clientX - rect.left) / width) * 2 - 1;
		let y = 1 - ((clientY - rect.top) / height) * 2;

		const radiusSq = x * x + y * y;
		if (radiusSq > 1) {
			const inv = 1 / Math.sqrt(radiusSq);
			x *= inv;
			y *= inv;
			return [x, y, 0];
		}

		return [x, y, Math.sqrt(1 - radiusSq)];
	};

	const commitMove = () => {
		if (!currentMove) return;

		const axisVector = AXIS_VECTORS[currentMove.axis];
		const axisIndex = AXIS_INDEX[currentMove.axis];
		const angle = HALF_PI * currentMove.direction;
		const deltaQ = quatFromAxisAngle(axisVector, angle);

		for (const cubelet of cubelets) {
			if (Math.round(cubelet.position[axisIndex]) !== currentMove.layer) {
				continue;
			}

			const rotated = quatRotateVec(deltaQ, cubelet.position);
			cubelet.position = [
				Math.round(rotated[0]) as Layer,
				Math.round(rotated[1]) as Layer,
				Math.round(rotated[2]) as Layer
			];
			cubelet.quaternion = quatMultiply(deltaQ, cubelet.quaternion);
		}

		syncBaseBuffers();
		baseBuffersDirty = true;

		isAnimating = false;
		moveProgress = 0;
		currentMoveAngle = 0;
		currentMove = null;
		timeSinceLastMove = 0;
	};

	const beginMove = (move: Move) => {
		if (isAnimating) return;
		currentMove = move;
		lastMoveAxis = move.axis;
		isAnimating = true;
		moveProgress = 0;
		currentMoveAngle = 0;
	};

	const selectNextMove = () => {
		const candidates = POSSIBLE_MOVES.filter((move) => move.axis !== lastMoveAxis);
		if (candidates.length === 0) {
			return;
		}
		const next = candidates[Math.floor(Math.random() * candidates.length)];
		beginMove(next);
	};

	const beginDrag = (
		state: { time: number },
		event: PointerEvent,
		canvas: HTMLCanvasElement
	): void => {
		isDragging = true;
		lastPointerTime = state.time;
		lastArcballVec = projectPointerToArcball(event.clientX, event.clientY, canvas);
		dragVelocityY = 0;
		dragVelocityX = 0;
		dragAngularSpeed = 0;
		dragAngularAxis = [0, 1, 0];
		momentumVelocityY = 0;
		momentumVelocityX = 0;
		momentumAngularSpeed = 0;
		momentumAngularAxis = [0, 1, 0];
		canvas.style.cursor = 'grabbing';
	};

	const updateDrag = (
		state: { deltaPx: [number, number]; time: number },
		event: PointerEvent,
		canvas: HTMLCanvasElement
	): void => {
		if (!isDragging) return;
		const dt = Math.max(0.001, state.time - lastPointerTime);
		lastPointerTime = state.time;

		const rotateDeltaY = state.deltaPx[0] * DRAG_SENSITIVITY;
		const rotateDeltaX = state.deltaPx[1] * DRAG_SENSITIVITY;

		const arcballVec = projectPointerToArcball(event.clientX, event.clientY, canvas);
		if (lastArcballVec) {
			const deltaQuat = quatFromUnitVectors(lastArcballVec, arcballVec);
			sceneQuat = quatMultiply(deltaQuat, sceneQuat);

			const angularAxisLength = Math.hypot(deltaQuat[0], deltaQuat[1], deltaQuat[2]);
			if (angularAxisLength > 1e-5) {
				dragAngularAxis = normalizeVec3([deltaQuat[0], deltaQuat[1], deltaQuat[2]]);
				const angularDelta = 2 * Math.atan2(angularAxisLength, Math.abs(deltaQuat[3]));
				const instantAngularSpeed = angularDelta / dt;
				dragAngularSpeed += (instantAngularSpeed - dragAngularSpeed) * ANGULAR_VELOCITY_SMOOTHING;
			}
		}
		lastArcballVec = arcballVec;

		const instantVelocityY = rotateDeltaY / dt;
		const instantVelocityX = rotateDeltaX / dt;
		dragVelocityY += (instantVelocityY - dragVelocityY) * DRAG_VELOCITY_SMOOTHING;
		dragVelocityX += (instantVelocityX - dragVelocityX) * DRAG_VELOCITY_SMOOTHING;
	};

	const endDrag = (canvas: HTMLCanvasElement): void => {
		if (!isDragging) return;
		isDragging = false;
		momentumVelocityY = dragVelocityY;
		momentumVelocityX = dragVelocityX;
		momentumAngularSpeed = dragAngularSpeed;
		momentumAngularAxis = dragAngularAxis;
		lastArcballVec = null;
		canvas.style.cursor = 'grab';
	};

	usePointer({
		onDown: (state, event) => {
			const canvas = motion.canvas;
			if (!canvas) return;
			beginDrag(state, event, canvas);
		},
		onMove: (state, event) => {
			if (!state.pressed) return;
			const canvas = motion.canvas;
			if (!canvas) return;
			updateDrag(state, event, canvas);
		},
		onUp: () => {
			const canvas = motion.canvas;
			if (!canvas) return;
			endDrag(canvas);
		}
	});

	onMount(() => {
		const canvas = motion.canvas;
		if (!canvas) return;

		canvas.style.cursor = 'grab';
		canvas.style.touchAction = 'none';

		return () => {
			canvas.style.cursor = '';
			canvas.style.touchAction = '';
		};
	});

	useFrame((state) => {
		let yawDelta = 0;

		if (!isDragging) {
			yawDelta += state.delta * AUTO_ROTATE_SPEED;
			yawDelta += momentumVelocityY * state.delta;

			const decay = Math.exp(-MOMENTUM_DECAY * state.delta);
			momentumVelocityY *= decay;
			momentumVelocityX *= decay;
			momentumAngularSpeed *= decay;

			if (Math.abs(momentumVelocityY) < MOMENTUM_MIN_SPEED) {
				momentumVelocityY = 0;
			}
			if (Math.abs(momentumVelocityX) < MOMENTUM_MIN_SPEED) {
				momentumVelocityX = 0;
			}
			if (momentumAngularSpeed < MOMENTUM_MIN_ANGULAR_SPEED) {
				momentumAngularSpeed = 0;
			}
		}

		applyOrbitDelta(yawDelta, 0);
		if (!isDragging && momentumAngularSpeed > 0) {
			const momentumQuat = quatFromAxisAngle(
				momentumAngularAxis,
				momentumAngularSpeed * state.delta
			);
			sceneQuat = quatMultiply(momentumQuat, sceneQuat);
		}

		if (isAnimating && currentMove) {
			moveProgress = Math.min(1, moveProgress + state.delta / MOVE_DURATION);
			const eased = easeInOutCubic(moveProgress);
			currentMoveAngle = HALF_PI * currentMove.direction * eased;

			if (moveProgress >= 1) {
				commitMove();
			}
		} else {
			timeSinceLastMove += state.delta;
			if (timeSinceLastMove >= MOVE_DELAY) {
				selectNextMove();
			}
		}

		const canvas = motion.canvas;
		let cubeScale = BASE_CUBE_SCALE;
		let cubeGap = BASE_CUBE_GAP;
		let roundRadius = BASE_ROUND_RADIUS;
		let sceneBound = 2.7;

		if (canvas) {
			const shortEdge = Math.max(320, Math.min(canvas.clientWidth, canvas.clientHeight));
			const sizeFactor = Math.max(0.7, Math.min(1.18, shortEdge / REFERENCE_VIEWPORT));
			cubeScale = BASE_CUBE_SCALE * sizeFactor;
			cubeGap = BASE_CUBE_GAP * sizeFactor;
			roundRadius = Math.min(BASE_ROUND_RADIUS * sizeFactor, cubeScale * 0.22);

			const spacingForBounds = cubeScale + cubeGap;
			const clusterHalfExtent = spacingForBounds + cubeScale * 0.5;
			sceneBound = Math.sqrt(3) * clusterHalfExtent + 0.42;
		}

		const spacing = cubeScale + cubeGap;
		let activeMoveQuat: Quat = IDENTITY_QUAT;
		let activeAxis = 0;
		let activeLayer = 0;
		let moveActive = 0;

		if (isAnimating && currentMove) {
			activeMoveQuat = quatFromAxisAngle(AXIS_VECTORS[currentMove.axis], currentMoveAngle);
			activeAxis = AXIS_INDEX[currentMove.axis];
			activeLayer = currentMove.layer;
			moveActive = 1;
		}

		state.setUniform('uSceneQuat', sceneQuat);
		state.setUniform('uMoveQuat', activeMoveQuat);
		state.setUniform('uSpacing', spacing);
		state.setUniform('uActiveAxis', activeAxis);
		state.setUniform('uActiveLayer', activeLayer);
		state.setUniform('uMoveActive', moveActive);

		state.setUniform('uCubeScale', cubeScale);
		state.setUniform('uRoundRadius', roundRadius);
		state.setUniform('uSceneBound', sceneBound);

		if (baseBuffersDirty) {
			state.writeStorageBuffer('cubeBasePositions', basePositionBuffer);
			state.writeStorageBuffer('cubeBaseQuaternions', baseQuaternionBuffer);
			baseBuffersDirty = false;
		}
	});
</script>
