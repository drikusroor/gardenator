/**
 * GLSL for the ray-traced render mode.
 *
 * This is a from-scratch, deliberately small progressive path tracer — a
 * single Lambertian bounce model with next-event estimation towards the sun
 * — rather than a port of erichlof's THREE.js-PathTracing-Renderer
 * (https://github.com/erichlof/THREE.js-PathTracing-Renderer). That project
 * is a collection of standalone demo pages, each with its own hand-tuned
 * shader for a specific scene and material set (PBR importance sampling,
 * volumetrics, bi-directional tracing, texture atlases…); there is no
 * general-purpose "renderer" module in it that a scene like this one's
 * (arbitrary procedural garden geometry, rebuilt every edit) could import.
 * What *is* directly reused from it is the technique this module's BVH
 * comes from (see `bvh.ts`) and the classic ray/box/triangle intersection
 * math, which is standard and CC0-licensed there.
 *
 * The renderer here does borrow its shape from that project's GLTF/BVH
 * demos: a flattened BVH in a data texture, walked with an explicit stack,
 * leaves resolving to a triangle data texture, one path per pixel per
 * frame, accumulated with additive blending into a float render target
 * until the camera moves again. Materials are flattened to a diffuse colour
 * + emissive per triangle (see `sceneData.ts`) rather than the source
 * project's full texture/BRDF pipeline — a deliberate scope cut so this
 * stays small enough to rebuild on every scene edit.
 */

export const FULLSCREEN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const PATHTRACE_FRAGMENT = /* glsl */ `
  #define PI 3.14159265359
  #define ONE_OVER_PI 0.31830988618
  #define INFINITY 1.0e10
  #define STACK_SIZE 64

  varying vec2 vUv;

  // Lower while the camera is moving so orbit/fly/walk stays responsive —
  // see PathTracer's render-scale ramp.
  uniform int uMaxBounces;

  uniform sampler2D tTriangleTexture;
  uniform vec2 uTriangleTextureSize;
  uniform sampler2D tBvhTexture;
  uniform vec2 uBvhTextureSize;
  uniform float uTriangleCount;

  uniform mat4 uCameraMatrix;
  uniform float uCameraFovScale;
  uniform float uCameraAspect;
  uniform vec2 uResolution;
  uniform float uFrameCounter;

  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform float uSunIntensity;
  uniform float uSunVisible;
  uniform vec3 uSkyTop;
  uniform vec3 uSkyBottom;
  uniform vec3 uAmbientColor;

  // ---------------------------------------------------------------- random

  uint pcgHash(uint v) {
    uint state = v * 747796405u + 2891336453u;
    uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
  }

  float randFloat(inout uint state) {
    state = pcgHash(state);
    return float(state) / 4294967295.0;
  }

  vec2 randVec2(inout uint state) {
    return vec2(randFloat(state), randFloat(state));
  }

  // ------------------------------------------------------------ intersect

  float boundingBoxIntersect(vec3 minCorner, vec3 maxCorner, vec3 rayOrigin, vec3 invDir) {
    vec3 tMin = (minCorner - rayOrigin) * invDir;
    vec3 tMax = (maxCorner - rayOrigin) * invDir;
    vec3 t1 = min(tMin, tMax);
    vec3 t2 = max(tMin, tMax);
    float tNear = max(max(t1.x, t1.y), t1.z);
    float tFar = min(min(t2.x, t2.y), t2.z);
    return (tNear <= tFar && tFar > 0.0) ? max(tNear, 0.0) : INFINITY;
  }

  // Double-sided Moeller-Trumbore: the garden's geometry includes a lot of
  // single-layer double-sided quads (fence slats, foliage cards, glass), so
  // culling by winding order would punch holes in them.
  float triangleIntersect(vec3 v0, vec3 v1, vec3 v2, vec3 rayOrigin, vec3 rayDir) {
    vec3 edge1 = v1 - v0;
    vec3 edge2 = v2 - v0;
    vec3 pvec = cross(rayDir, edge2);
    float det = dot(edge1, pvec);
    if (abs(det) < 1e-9) return INFINITY;
    float invDet = 1.0 / det;
    vec3 tvec = rayOrigin - v0;
    float u = dot(tvec, pvec) * invDet;
    if (u < 0.0 || u > 1.0) return INFINITY;
    vec3 qvec = cross(tvec, edge1);
    float v = dot(rayDir, qvec) * invDet;
    if (v < 0.0 || u + v > 1.0) return INFINITY;
    float t = dot(edge2, qvec) * invDet;
    return t > 1e-4 ? t : INFINITY;
  }

  // ----------------------------------------------------------------- BVH

  vec4 fetchTexel(sampler2D tex, float index, vec2 size) {
    float col = mod(index, size.x);
    float row = floor(index / size.x);
    return texelFetch(tex, ivec2(int(col), int(row)), 0);
  }

  void getNode(float nodeIndex, out vec4 d0, out vec4 d1) {
    float base = nodeIndex * 2.0;
    d0 = fetchTexel(tBvhTexture, base + 0.0, uBvhTextureSize);
    d1 = fetchTexel(tBvhTexture, base + 1.0, uBvhTextureSize);
  }

  void getTriangleVerts(float triIndex, out vec3 v0, out vec3 v1, out vec3 v2) {
    float base = triIndex * 5.0;
    vec4 t0 = fetchTexel(tTriangleTexture, base + 0.0, uTriangleTextureSize);
    vec4 t1 = fetchTexel(tTriangleTexture, base + 1.0, uTriangleTextureSize);
    vec4 t2 = fetchTexel(tTriangleTexture, base + 2.0, uTriangleTextureSize);
    v0 = t0.xyz;
    v1 = vec3(t0.w, t1.xy);
    v2 = vec3(t1.zw, t2.x);
  }

  void getTriangleShading(float triIndex, out vec3 normal, out vec3 color, out vec3 emissive) {
    float base = triIndex * 5.0;
    vec4 t2 = fetchTexel(tTriangleTexture, base + 2.0, uTriangleTextureSize);
    vec4 t3 = fetchTexel(tTriangleTexture, base + 3.0, uTriangleTextureSize);
    vec4 t4 = fetchTexel(tTriangleTexture, base + 4.0, uTriangleTextureSize);
    normal = t2.yzw;
    color = t3.xyz;
    emissive = vec3(t3.w, t4.xy);
  }

  // Iterative BVH walk. Children are pushed unsorted (no near/far ordering)
  // to keep this tractable to get right — the box-distance prune below still
  // avoids most of the tree for typical garden-sized scenes.
  float sceneIntersect(vec3 rayOrigin, vec3 rayDirection, out vec3 hitNormal, out vec3 hitColor, out vec3 hitEmissive) {
    float stack[STACK_SIZE];
    int stackPtr = 1;
    stack[0] = 0.0;

    vec3 invDir = 1.0 / rayDirection;
    float closestT = INFINITY;
    float hitTri = -1.0;

    while (stackPtr > 0) {
      stackPtr -= 1;
      float nodeIndex = stack[stackPtr];

      vec4 d0, d1;
      getNode(nodeIndex, d0, d1);
      vec3 mn = d0.xyz;
      vec3 mx = vec3(d0.w, d1.xy);

      float boxT = boundingBoxIntersect(mn, mx, rayOrigin, invDir);
      if (boxT >= closestT) continue;

      float triCount = d1.z;
      float leftFirst = d1.w;

      if (triCount == 0.0) {
        if (stackPtr < STACK_SIZE - 2) {
          stack[stackPtr] = leftFirst; stackPtr += 1;
          stack[stackPtr] = leftFirst + 1.0; stackPtr += 1;
        }
      } else {
        vec3 v0, v1, v2;
        getTriangleVerts(leftFirst, v0, v1, v2);
        float t = triangleIntersect(v0, v1, v2, rayOrigin, rayDirection);
        if (t < closestT) {
          closestT = t;
          hitTri = leftFirst;
        }
      }
    }

    if (hitTri < 0.0) return INFINITY;
    getTriangleShading(hitTri, hitNormal, hitColor, hitEmissive);
    return closestT;
  }

  bool occluded(vec3 rayOrigin, vec3 rayDirection) {
    vec3 n, c, e;
    return sceneIntersect(rayOrigin, rayDirection, n, c, e) < INFINITY;
  }

  // ------------------------------------------------------------------ sky
  // Mirrors the rasterised sky dome in src/render/sky.ts so both render
  // modes agree on what the sky looks like.
  vec3 skyColor(vec3 dir) {
    float h = clamp(dir.y * 1.15 + 0.08, 0.0, 1.0);
    vec3 sky = mix(uSkyBottom, uSkyTop, pow(h, 0.55));
    float cosAngle = dot(dir, normalize(uSunDirection));
    float disc = smoothstep(0.9994, 0.9997, cosAngle);
    float halo = pow(max(cosAngle, 0.0), 220.0) * 0.55 + pow(max(cosAngle, 0.0), 12.0) * 0.14;
    sky += uSunColor * (disc * 2.2 + halo) * uSunVisible;
    return sky;
  }

  vec3 cosineSampleHemisphere(vec3 n, vec2 u) {
    float r = sqrt(u.x);
    float theta = 2.0 * PI * u.y;
    vec3 helper = abs(n.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 tangent = normalize(cross(helper, n));
    vec3 bitangent = cross(n, tangent);
    return normalize(tangent * (r * cos(theta)) + bitangent * (r * sin(theta)) + n * sqrt(max(0.0, 1.0 - u.x)));
  }

  vec3 tracePath(vec3 rayOrigin, vec3 rayDirection, inout uint rng) {
    vec3 throughput = vec3(1.0);
    vec3 radiance = vec3(0.0);

    for (int bounce = 0; bounce < uMaxBounces; bounce++) {
      vec3 hitNormal, hitColor, hitEmissive;
      float t = sceneIntersect(rayOrigin, rayDirection, hitNormal, hitColor, hitEmissive);

      if (t >= INFINITY) {
        radiance += throughput * skyColor(rayDirection);
        break;
      }

      vec3 hitPoint = rayOrigin + rayDirection * t;
      vec3 normal = dot(hitNormal, rayDirection) < 0.0 ? hitNormal : -hitNormal;

      radiance += throughput * hitEmissive;
      // Cheap ambient fill so single-bounce corners aren't pitch black
      // between accumulated samples — a coarse stand-in for the skylight
      // the rasteriser's hemisphere light provides directly.
      radiance += throughput * hitColor * uAmbientColor;

      if (uSunVisible > 0.001) {
        float ndotl = dot(normal, uSunDirection);
        if (ndotl > 0.0) {
          vec3 shadowOrigin = hitPoint + normal * 0.001;
          if (!occluded(shadowOrigin, uSunDirection)) {
            radiance += throughput * hitColor * ONE_OVER_PI * uSunColor * uSunIntensity * uSunVisible * ndotl;
          }
        }
      }

      throughput *= hitColor;

      if (bounce > 1) {
        float p = clamp(max(throughput.r, max(throughput.g, throughput.b)), 0.05, 1.0);
        if (randFloat(rng) > p) break;
        throughput /= p;
      }

      rayOrigin = hitPoint + normal * 0.001;
      rayDirection = cosineSampleHemisphere(normal, randVec2(rng));
    }

    return radiance;
  }

  void main() {
    uint rng = uint(gl_FragCoord.x) * 1973u + uint(gl_FragCoord.y) * 9277u + uint(uFrameCounter) * 26699u | 1u;

    vec2 jitter = (randVec2(rng) - 0.5) / uResolution;
    vec2 ndc = (vUv + jitter) * 2.0 - 1.0;

    vec3 rayDirLocal = normalize(vec3(ndc.x * uCameraAspect * uCameraFovScale, ndc.y * uCameraFovScale, -1.0));
    vec3 rayDirection = normalize((uCameraMatrix * vec4(rayDirLocal, 0.0)).xyz);
    vec3 rayOrigin = uCameraMatrix[3].xyz;

    vec3 color = uTriangleCount > 0.0 ? tracePath(rayOrigin, rayDirection, rng) : skyColor(rayDirection);
    gl_FragColor = vec4(color, 1.0);
  }
`;

export const RESOLVE_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tAccumulated;

  void main() {
    vec4 accumulated = texture2D(tAccumulated, vUv);
    vec3 color = accumulated.a > 0.0 ? accumulated.rgb / accumulated.a : vec3(0.0);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
