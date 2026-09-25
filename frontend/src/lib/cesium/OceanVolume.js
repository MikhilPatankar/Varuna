/**
 * OceanVolume.js
 * Builds a 3D volumetric representation of the ocean from the seabed up to the surface.
 *
 * Approach:
 *   - Divides the bbox into a grid of cells
 *   - For each ocean cell, creates an extruded polygon from seabed depth → sea surface (0m)
 *   - Colors each column by depth using a GEBCO-style deep-sea colormap
 *   - Cesium batches all columns into a single GPU draw call
 *
 * Result: tilt the camera and you see the 3D interior — the "hollowed earth" effect
 */

import {
  Cartesian3,
  Color,
  GeometryInstance,
  PolygonGeometry,
  PolygonHierarchy,
  Primitive,
  PerInstanceColorAppearance,
  ColorGeometryInstanceAttribute,
} from 'cesium'

// ── GEBCO-inspired deep-sea colormap ─────────────────────────────────────────
const STOPS = [
  [85,  195, 255],   // 0m      shallow turquoise #55C3FF
  [30,  140, 210],   // 600m
  [6,   96,  155],   // 1500m   mid-ocean #06609B
  [5,   66,  116],   // 3000m   navy      #064274
  [3,   40,   80],   // 4500m   deep navy
  [1,   15,   40],   // 6000m+  abyssal
]

function depthToColor(depthM, alpha = 215) {
  const t = Math.min(depthM / 6000, 1)
  const s = t * (STOPS.length - 1)
  const lo = Math.floor(s)
  const hi = Math.min(lo + 1, STOPS.length - 1)
  const f  = s - lo
  const c  = STOPS[lo].map((v, i) => Math.round(v + (STOPS[hi][i] - v) * f))
  return Color.fromBytes(c[0], c[1], c[2], alpha)
}

/**
 * Build an array of PerInstanceColor GeometryInstances for the ocean volume.
 *
 * @param {Float32Array} depths        - [nLat × nLon], metres, negative = ocean
 * @param {number[]}     shape         - [nLat, nLon]
 * @param {object}       bbox          - { lonMin, lonMax, latMin, latMax }
 * @param {object}       opts
 * @param {number}       opts.gridRes        - cells per axis (default 80)
 * @param {number}       opts.vertExagg      - vertical exaggeration (default 30)
 * @param {number}       opts.depthAlpha     - column alpha 0-255 (default 215)
 * @returns {GeometryInstance[]}
 */
export function buildOceanVolumeInstances(depths, shape, bbox, opts = {}) {
  const { gridRes = 80, vertExagg = 30, depthAlpha = 215 } = opts
  const [nLat, nLon] = shape
  const { lonMin, lonMax, latMin, latMax } = bbox
  const dLon = (lonMax - lonMin) / gridRes
  const dLat = (latMax - latMin) / gridRes

  const instances = []

  for (let gi = 0; gi < gridRes; gi++) {
    for (let gj = 0; gj < gridRes; gj++) {
      // Sample the nearest data point
      const si = Math.min(Math.round((gi / gridRes) * (nLat - 1)), nLat - 1)
      const sj = Math.min(Math.round((gj / gridRes) * (nLon - 1)), nLon - 1)
      const depth = depths[si * nLon + sj]           // metres, negative = ocean

      if (depth >= -1 || depth <= -9000) continue    // skip land and sentinel

      const lon      = lonMin + gj * dLon
      const lat      = latMin + gi * dLat
      const seabedH  = depth * vertExagg              // negative → pulls vertex down

      instances.push(
        new GeometryInstance({
          geometry: new PolygonGeometry({
            polygonHierarchy: new PolygonHierarchy(
              Cartesian3.fromDegreesArray([
                lon,        lat,
                lon + dLon, lat,
                lon + dLon, lat + dLat,
                lon,        lat + dLat,
              ])
            ),
            height:         seabedH,   // bottom face (seabed)
            extrudedHeight: 0,         // top face    (sea surface)
            vertexFormat:   PerInstanceColorAppearance.VERTEX_FORMAT,
          }),
          attributes: {
            color: ColorGeometryInstanceAttribute.fromColor(
              depthToColor(-depth, depthAlpha)
            ),
          },
        })
      )
    }
  }

  return instances
}

/**
 * Add the ocean volume to the Cesium scene.
 * Cesium merges all instances into one batched GPU draw call.
 */
export function addOceanVolumePrimitive(viewer, instances) {
  if (!instances.length) return null

  const primitive = new Primitive({
    geometryInstances:        instances,
    appearance:               new PerInstanceColorAppearance({ translucent: true }),
    asynchronous:             true,   // tessellate in background — won't freeze UI
    releaseGeometryInstances: true,   // free CPU memory after GPU upload
  })

  viewer.scene.primitives.add(primitive)
  return primitive
}
