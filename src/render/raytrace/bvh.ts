/**
 * Binned-SAH BVH builder for the GPU path tracer.
 *
 * Ported to TypeScript from `BVH_Quick_Builder.js` in Erich Loftis's
 * THREE.js-PathTracing-Renderer (https://github.com/erichlof/THREE.js-PathTracing-Renderer),
 * released under CC0 — public domain, no attribution required, credited here
 * anyway since the binning/quick-build technique is directly theirs (in turn
 * based on Jacco Bikker's "How To Build a BVH" article series). Reworked into
 * a single pure function operating on typed arrays instead of module-level
 * mutable state, so multiple BVHs can be built without cross-talk.
 *
 * Input: `aabb` holds, for each of `triangleCount` triangles, 9 floats —
 * [minX,minY,minZ, maxX,maxY,maxZ, centroidX,centroidY,centroidZ] — starting
 * at offset `triangleCount * 9`. The array must have room for the *output*
 * too: `triangleCount * 2` nodes * 8 floats, written starting at offset 0.
 * Two triangles' worth of node storage per triangle is the worst case for a
 * binary tree with N leaves, so `aabb.length` must be at least
 * `Math.max(triangleCount * 9, triangleCount * 2 * 8)`.
 *
 * Output layout per node (8 floats, matching the shader's `GetBoxNodeData`):
 *   texel0 = minCorner.x, minCorner.y, minCorner.z, maxCorner.x
 *   texel1 = maxCorner.y, maxCorner.z, triCount,     leftFirst
 * `triCount === 0` marks an inner node whose children sit at
 * `leftFirst`/`leftFirst + 1`; otherwise it's a leaf and `leftFirst` is the
 * triangle index directly (already de-referenced through the sort order).
 */

const BIN_COUNT = 32;

class BvhNode {
  minX = Infinity;
  minY = Infinity;
  minZ = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;
  maxZ = -Infinity;
  triCount = 0;
  leftFirst = 0;
}

interface Bin {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  triCount: number;
}

function freshBin(): Bin {
  return { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity, triCount: 0 };
}

/** Builds a flattened BVH over `triangleCount` triangles, in place in `aabb`. */
export function buildBVH(aabb: Float32Array, triangleCount: number): { nodeCount: number } {
  if (triangleCount === 0) return { nodeCount: 0 };

  const srcOffset = 0; // input triangle AABBs live at the start of the buffer
  const src = aabb.slice(srcOffset, srcOffset + triangleCount * 9);

  const triIdx = new Uint32Array(triangleCount);
  for (let i = 0; i < triangleCount; i++) triIdx[i] = i;

  const nodes: BvhNode[] = [];
  for (let i = 0; i < triangleCount * 2; i++) nodes.push(new BvhNode());

  let nodesUsed = 2; // offsets child pairs onto even boundaries (2-3, 4-5, ...)

  const centroid = (tri: number, axis: number) => src[9 * tri + 6 + axis];

  function updateBounds(nodeIdx: number) {
    const node = nodes[nodeIdx];
    node.minX = node.minY = node.minZ = Infinity;
    node.maxX = node.maxY = node.maxZ = -Infinity;
    for (let i = 0; i < node.triCount; i++) {
      const k = triIdx[node.leftFirst + i];
      const b = 9 * k;
      node.minX = Math.min(node.minX, src[b + 0]);
      node.minY = Math.min(node.minY, src[b + 1]);
      node.minZ = Math.min(node.minZ, src[b + 2]);
      node.maxX = Math.max(node.maxX, src[b + 3]);
      node.maxY = Math.max(node.maxY, src[b + 4]);
      node.maxZ = Math.max(node.maxZ, src[b + 5]);
    }
  }

  const bins: Bin[] = [];
  const leftArea = new Float32Array(BIN_COUNT - 1);
  const rightArea = new Float32Array(BIN_COUNT - 1);
  const leftCountSum = new Uint32Array(BIN_COUNT - 1);
  const rightCountSum = new Uint32Array(BIN_COUNT - 1);

  function subdivide(nodeIdx: number) {
    const node = nodes[nodeIdx];
    if (node.triCount < 2) {
      node.leftFirst = triIdx[node.leftFirst];
      return;
    }

    let bestCost = Infinity;
    let bestAxis = 0;
    let bestSplitPos = Infinity;
    const first = node.leftFirst;

    for (let axis = 0; axis < 3; axis++) {
      let boundsMin = Infinity;
      let boundsMax = -Infinity;
      for (let i = 0; i < node.triCount; i++) {
        const c = centroid(triIdx[first + i], axis);
        boundsMin = Math.min(boundsMin, c);
        boundsMax = Math.max(boundsMax, c);
      }
      if (boundsMin === boundsMax) continue;

      for (let i = 0; i < BIN_COUNT; i++) bins[i] = freshBin();
      const scaleIn = BIN_COUNT / (boundsMax - boundsMin);
      for (let i = 0; i < node.triCount; i++) {
        const k = triIdx[first + i];
        const b = 9 * k;
        const c = centroid(k, axis);
        const binIdx = Math.min(BIN_COUNT - 1, Math.floor((c - boundsMin) * scaleIn));
        const bin = bins[binIdx];
        bin.triCount++;
        bin.minX = Math.min(bin.minX, src[b + 0]);
        bin.minY = Math.min(bin.minY, src[b + 1]);
        bin.minZ = Math.min(bin.minZ, src[b + 2]);
        bin.maxX = Math.max(bin.maxX, src[b + 3]);
        bin.maxY = Math.max(bin.maxY, src[b + 4]);
        bin.maxZ = Math.max(bin.maxZ, src[b + 5]);
      }

      let leftSum = 0;
      let rightSum = 0;
      let leftMinX = Infinity, leftMinY = Infinity, leftMinZ = Infinity;
      let leftMaxX = -Infinity, leftMaxY = -Infinity, leftMaxZ = -Infinity;
      let rightMinX = Infinity, rightMinY = Infinity, rightMinZ = Infinity;
      let rightMaxX = -Infinity, rightMaxY = -Infinity, rightMaxZ = -Infinity;

      for (let i = 0; i < BIN_COUNT - 1; i++) {
        const l = bins[i];
        leftSum += l.triCount;
        leftCountSum[i] = leftSum;
        leftMinX = Math.min(leftMinX, l.minX); leftMinY = Math.min(leftMinY, l.minY); leftMinZ = Math.min(leftMinZ, l.minZ);
        leftMaxX = Math.max(leftMaxX, l.maxX); leftMaxY = Math.max(leftMaxY, l.maxY); leftMaxZ = Math.max(leftMaxZ, l.maxZ);
        const lex = leftMaxX - leftMinX, ley = leftMaxY - leftMinY, lez = leftMaxZ - leftMinZ;
        leftArea[i] = lex * ley + ley * lez + lez * lex;

        const r = bins[BIN_COUNT - 1 - i];
        rightSum += r.triCount;
        rightCountSum[BIN_COUNT - 2 - i] = rightSum;
        rightMinX = Math.min(rightMinX, r.minX); rightMinY = Math.min(rightMinY, r.minY); rightMinZ = Math.min(rightMinZ, r.minZ);
        rightMaxX = Math.max(rightMaxX, r.maxX); rightMaxY = Math.max(rightMaxY, r.maxY); rightMaxZ = Math.max(rightMaxZ, r.maxZ);
        const rex = rightMaxX - rightMinX, rey = rightMaxY - rightMinY, rez = rightMaxZ - rightMinZ;
        rightArea[BIN_COUNT - 2 - i] = rex * rey + rey * rez + rez * rex;
      }

      const scaleOut = (boundsMax - boundsMin) / BIN_COUNT;
      for (let i = 0; i < BIN_COUNT - 1; i++) {
        const planeCost = leftCountSum[i] * leftArea[i] + rightCountSum[i] * rightArea[i];
        if (planeCost < bestCost) {
          bestCost = planeCost;
          bestAxis = axis;
          bestSplitPos = boundsMin + scaleOut * (i + 1);
        }
      }
    }

    const extentX = node.maxX - node.minX, extentY = node.maxY - node.minY, extentZ = node.maxZ - node.minZ;
    const parentArea = extentX * extentY + extentY * extentZ + extentZ * extentX;
    const parentCost = node.triCount * parentArea;
    let splitPos = bestSplitPos;
    if (bestCost >= parentCost) splitPos = Infinity;

    let i = node.leftFirst;
    let j = i + node.triCount - 1;
    while (i <= j) {
      if (centroid(triIdx[i], bestAxis) < splitPos) {
        i++;
      } else {
        const tmp = triIdx[i];
        triIdx[i] = triIdx[j];
        triIdx[j] = tmp;
        j--;
      }
    }

    let leftCount = i - node.leftFirst;
    if (leftCount === 0 || leftCount === node.triCount) {
      // Degenerate split (e.g. many coincident centroids) — fall back to an
      // even halves split so the recursion still terminates.
      leftCount = Math.floor(node.triCount / 2);
    }

    const leftChildIdx = nodesUsed++;
    const rightChildIdx = nodesUsed++;
    nodes[leftChildIdx].leftFirst = node.leftFirst;
    nodes[leftChildIdx].triCount = leftCount;
    nodes[rightChildIdx].leftFirst = node.leftFirst + leftCount;
    nodes[rightChildIdx].triCount = node.triCount - leftCount;
    node.leftFirst = leftChildIdx;
    node.triCount = 0;
    updateBounds(leftChildIdx);
    updateBounds(rightChildIdx);
    subdivide(leftChildIdx);
    subdivide(rightChildIdx);
  }

  const root = nodes[0];
  root.leftFirst = 0;
  root.triCount = triangleCount;
  updateBounds(0);
  subdivide(0);

  // Only `nodesUsed` nodes are ever reachable from the root — the rest of
  // the preallocated array is dead space, so there's no need to write it out.
  for (let i = 0; i < nodesUsed; i++) {
    const node = nodes[i];
    const o = 8 * i;
    aabb[o + 0] = node.minX;
    aabb[o + 1] = node.minY;
    aabb[o + 2] = node.minZ;
    aabb[o + 3] = node.maxX;
    aabb[o + 4] = node.maxY;
    aabb[o + 5] = node.maxZ;
    aabb[o + 6] = node.triCount;
    aabb[o + 7] = node.leftFirst;
  }

  return { nodeCount: nodesUsed };
}
