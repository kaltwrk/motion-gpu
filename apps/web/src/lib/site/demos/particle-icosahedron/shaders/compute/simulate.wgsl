const FACE_COUNT: u32 = 20u;
const PARTICLE_COUNT: u32 = 2560000u;
const PARTICLE_STRIDE: u32 = 5u;
const PARTICLE_SHARD_CAPACITY: u32 = 640000u;
const TEX_SIZE_F: f32 = 2056.0;
const TEX_SIZE_I: i32 = 2056;
const PHI: f32 = 1.61803398875;
const PI: f32 = 3.1415926;
const BASE_RADIUS: f32 = 0.33;
const DISPLACE_AMPLITUDE: f32 = 0.11;
const EDGE_BURST: f32 = 0.045;
const MICRO_JITTER: f32 = 0.008;
const CAMERA_DIST: f32 = 1.95;

const ICO_VERTS: array<vec3f, 12> = array<vec3f, 12>(
    vec3f(-1.0, PHI, 0.0),
    vec3f(1.0, PHI, 0.0),
    vec3f(-1.0, -PHI, 0.0),
    vec3f(1.0, -PHI, 0.0),
    vec3f(0.0, -1.0, PHI),
    vec3f(0.0, 1.0, PHI),
    vec3f(0.0, -1.0, -PHI),
    vec3f(0.0, 1.0, -PHI),
    vec3f(PHI, 0.0, -1.0),
    vec3f(PHI, 0.0, 1.0),
    vec3f(-PHI, 0.0, -1.0),
    vec3f(-PHI, 0.0, 1.0)
);

const ICO_FACES: array<vec3u, 20> = array<vec3u, 20>(
    vec3u(0u, 11u, 5u),
    vec3u(0u, 5u, 1u),
    vec3u(0u, 1u, 7u),
    vec3u(0u, 7u, 10u),
    vec3u(0u, 10u, 11u),
    vec3u(1u, 5u, 9u),
    vec3u(5u, 11u, 4u),
    vec3u(11u, 10u, 2u),
    vec3u(10u, 7u, 6u),
    vec3u(7u, 1u, 8u),
    vec3u(3u, 9u, 4u),
    vec3u(3u, 4u, 2u),
    vec3u(3u, 2u, 6u),
    vec3u(3u, 6u, 8u),
    vec3u(3u, 8u, 9u),
    vec3u(4u, 9u, 5u),
    vec3u(2u, 4u, 11u),
    vec3u(6u, 2u, 10u),
    vec3u(8u, 6u, 7u),
    vec3u(9u, 8u, 1u)
);

fn hash33(p: vec3f) -> vec3f {
    let q = vec3f(
        dot(p, vec3f(127.1, 311.7, 74.7)),
        dot(p, vec3f(269.5, 183.3, 246.1)),
        dot(p, vec3f(113.5, 271.9, 124.6))
    );
    return fract(sin(q) * 43758.5453) * 2.0 - 1.0;
}

fn perlin3(p: vec3f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);

    let g000 = dot(hash33(i + vec3f(0.0, 0.0, 0.0)), f - vec3f(0.0, 0.0, 0.0));
    let g100 = dot(hash33(i + vec3f(1.0, 0.0, 0.0)), f - vec3f(1.0, 0.0, 0.0));
    let g010 = dot(hash33(i + vec3f(0.0, 1.0, 0.0)), f - vec3f(0.0, 1.0, 0.0));
    let g110 = dot(hash33(i + vec3f(1.0, 1.0, 0.0)), f - vec3f(1.0, 1.0, 0.0));
    let g001 = dot(hash33(i + vec3f(0.0, 0.0, 1.0)), f - vec3f(0.0, 0.0, 1.0));
    let g101 = dot(hash33(i + vec3f(1.0, 0.0, 1.0)), f - vec3f(1.0, 0.0, 1.0));
    let g011 = dot(hash33(i + vec3f(0.0, 1.0, 1.0)), f - vec3f(0.0, 1.0, 1.0));
    let g111 = dot(hash33(i + vec3f(1.0, 1.0, 1.0)), f - vec3f(1.0, 1.0, 1.0));

    let x00 = mix(g000, g100, u.x);
    let x10 = mix(g010, g110, u.x);
    let x01 = mix(g001, g101, u.x);
    let x11 = mix(g011, g111, u.x);
    let y0 = mix(x00, x10, u.y);
    let y1 = mix(x01, x11, u.y);

    return mix(y0, y1, u.z) * 0.5 + 0.5;
}

fn stylizedNoise(dir: vec3f, time: f32, seed: f32) -> f32 {
    let flow = vec3f(time * 0.2 + seed * 7.3, -time * 0.14 + seed * 5.1, time * 0.17 + seed * 3.9);
    let p = dir * 2.3 * 0.875 + flow;
    let n1 = perlin3(p);
    let n2 = perlin3(p * 1.93 + vec3f(2.7, 6.1, 4.3));
    var n = mix(n1, n2, 0.3);
    n = sin(n * PI * 8.0);
    n = n * 0.5 + 0.5;
    return n * n;
}

fn displacedPos(facePos: vec3f, faceNormal: vec3f, dir: vec3f, edgeWeight: f32, time: f32, seed: f32) -> vec3f {
    let n = stylizedNoise(dir, time, seed);
    let ridge = pow(1.0 - edgeWeight, 1.6);
    return facePos + faceNormal * (n * DISPLACE_AMPLITUDE + ridge * EDGE_BURST);
}

fn readParticleValue(index: u32, offset: u32) -> f32 {
    let shard = index / PARTICLE_SHARD_CAPACITY;
    let localIndex = index - shard * PARTICLE_SHARD_CAPACITY;
    let base = localIndex * PARTICLE_STRIDE + offset;

    switch shard {
        case 0u: { return particles0[base]; }
        case 1u: { return particles1[base]; }
        case 2u: { return particles2[base]; }
        case 3u: { return particles3[base]; }
        default: { return 0.0; }
    }
}

@compute @workgroup_size(256)
fn compute(@builtin(global_invocation_id) id: vec3u) {
    let idx = id.x;
    if idx >= PARTICLE_COUNT { return; }

    let faceIndex = min(idx / 128000u, FACE_COUNT - 1u);
    let u = readParticleValue(idx, 0u);
    let v = readParticleValue(idx, 1u);
    let phase = readParticleValue(idx, 2u);
    let speed = readParticleValue(idx, 3u);
    let seed = readParticleValue(idx, 4u);
    let w = max(0.0001, 1.0 - u - v);

    let face = ICO_FACES[faceIndex];
    let a = ICO_VERTS[face.x];
    let b = ICO_VERTS[face.y];
    let c = ICO_VERTS[face.z];

    let triPosRaw = a * w + b * u + c * v;
    let vertexRadius = length(a);
    let triPos = triPosRaw * (BASE_RADIUS / vertexRadius);
    var dir = normalize(triPosRaw);
    var faceNormal = normalize(cross(b - a, c - a));
    if dot(faceNormal, triPosRaw) < 0.0 {
        faceNormal = -faceNormal;
    }
    let edgeDistance = min(min(u, v), w);
    let edgeWeight = clamp(edgeDistance * 6.0, 0.0, 1.0);

    let t = spektralFrame.time * (0.25 + speed * 0.65) + phase;

    let tangentCandidate = cross(dir, vec3f(1.0, 0.0, 0.0)) + cross(dir, vec3f(0.0, 1.0, 0.0));
    let tangentFallback = cross(dir, vec3f(0.0, 0.0, 1.0));
    var tangent = tangentFallback;
    if length(tangentCandidate) > 0.0001 {
        tangent = tangentCandidate;
    }
    tangent = normalize(tangent);
    let bitangent = normalize(cross(tangent, dir));

    let p0 = displacedPos(triPos, faceNormal, dir, edgeWeight, t, seed);
    let theta = 0.055;
    let triPosT = (triPosRaw + tangent * theta) * (BASE_RADIUS / vertexRadius);
    let triPosB = (triPosRaw + bitangent * theta) * (BASE_RADIUS / vertexRadius);
    let ptTangent = displacedPos(triPosT, faceNormal, normalize(triPosRaw + tangent * theta), edgeWeight, t, seed);
    let ptBitangent = displacedPos(triPosB, faceNormal, normalize(triPosRaw + bitangent * theta), edgeWeight, t, seed);

    var normal = normalize(cross(ptBitangent - p0, ptTangent - p0));
    if dot(normal, dir) < 0.0 {
        normal = -normal;
    }
    normal = normalize(mix(faceNormal, normal, 0.55));

    var position = p0 + normal * sin(t * 1.9 + seed * 13.0) * MICRO_JITTER * (0.3 + (1.0 - edgeWeight));

    let rotY = spektralUniforms.uRotateY;
    let cosY = cos(rotY);
    let sinY = sin(rotY);
    let xz = vec2f(position.x * cosY - position.z * sinY, position.x * sinY + position.z * cosY);
    position = vec3f(xz.x, position.y, xz.y);
    normal = vec3f(normal.x * cosY - normal.z * sinY, normal.y, normal.x * sinY + normal.z * cosY);

    let rotX = spektralUniforms.uRotateX;
    let cosX = cos(rotX);
    let sinX = sin(rotX);
    let yz = vec2f(position.y * cosX - position.z * sinX, position.y * sinX + position.z * cosX);
    position = vec3f(position.x, yz.x, yz.y);
    normal = vec3f(normal.x, normal.y * cosX - normal.z * sinX, normal.y * sinX + normal.z * cosX);

    let lightDir = normalize(vec3f(0.75, 0.95, 0.55));
    let baseColor = vec3f(0.6, 0.212, 0.0);

    let cameraPos = vec3f(0.0, 0.0, CAMERA_DIST);
    let viewDir = normalize(cameraPos - position);
    let facing = max(dot(normal, viewDir), 0.0);
    if facing <= 0.02 { return; }

    let ambient = 3.34;
    let diffuse = max(dot(normal, lightDir), 0.0) * 12.14;

    let reflectDir = reflect(-lightDir, normal);

    let n = stylizedNoise(dir, t, seed);
    let ridge = pow(1.0 - edgeWeight, 1.4);

    var lit = baseColor * (ambient + diffuse);

    let depth = CAMERA_DIST + position.z;
    let perspective = CAMERA_DIST / max(depth, 0.06);
    let sx = position.x * perspective;
    let sy = position.y * perspective;

    let tx = i32((sx * 0.78 + 0.5) * TEX_SIZE_F);
    let ty = i32((-sy * 0.78 + 0.5) * TEX_SIZE_F);

    if tx >= 0 && tx < TEX_SIZE_I && ty >= 0 && ty < TEX_SIZE_I {
        let energy = (0.42 + n * 0.58 + ridge * 4.5) * clamp(perspective, 0.6, 1.7) * facing;
        let color = lit * energy * 0.045;
        textureStore(densityMap, vec2u(u32(tx), u32(ty)), vec4f(color, 1.0));
        textureStore(densityFrame, vec2u(u32(tx), u32(ty)), vec4f(spektralUniforms.uFrameId, 0.0, 0.0, 0.0));
    }
}
