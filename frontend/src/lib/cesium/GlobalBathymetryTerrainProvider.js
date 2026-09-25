import {
  Event,
  GeographicTilingScheme,
  HeightmapTerrainData,
} from 'cesium'

/**
 * Custom TerrainProvider that uses CMEMS deptho data to generate
 * true 3D ocean floor geometry globally.
 *
 * CMEMS deptho convention:
 *   - Positive values = depth below sea level in metres (7 to ~10,500)
 *   - NaN = land (no ocean at this point)
 *   - Latitude stored South-to-North (index 0 = ~-80°, last = 90°)
 *   - Longitude stored West-to-East (index 0 = -180°)
 *
 * We convert: elevation = -deptho  (so ocean floor is BELOW sea level = negative)
 * Land NaNs become 0.0 (sea level).
 */
export class GlobalBathymetryTerrainProvider {
  constructor(rawDepthArray, shape, bounds) {
    this._errorEvent  = new Event()
    this._tilingScheme = new GeographicTilingScheme()
    this._ready = true
    this._readyPromise = Promise.resolve(true)

    this.nLat  = shape[0]
    this.nLon  = shape[1]
    // bounds = { latMin, latMax, lonMin, lonMax }
    this.bounds = bounds || { latMin: -90, latMax: 90, lonMin: -180, lonMax: 180 }

    // Data is already pre-processed in GlobeView.jsx:
    // ocean = negative metres, land/sentinel = 0.0
    this._elev = rawDepthArray
  }

  get errorEvent()      { return this._errorEvent }
  get credit()          { return undefined }
  get tilingScheme()    { return this._tilingScheme }
  get ready()           { return this._ready }
  get readyPromise()    { return this._readyPromise }
  get hasWaterMask()    { return false }
  get hasVertexNormals(){ return false }

  requestTileGeometry(x, y, level) {
    const TILE_SIZE = 64
    const buffer = new Float32Array(TILE_SIZE * TILE_SIZE)

    // Get tile bounding box in degrees
    const rect   = this._tilingScheme.tileXYToRectangle(x, y, level)
    const lonMin = rect.west  * (180 / Math.PI)
    const lonMax  = rect.east  * (180 / Math.PI)
    const latMin = rect.south * (180 / Math.PI)
    const latMax  = rect.north * (180 / Math.PI)

    const { latMin: bLatMin, latMax: bLatMax, lonMin: bLonMin, lonMax: bLonMax } = this.bounds
    const latSpan = bLatMax - bLatMin
    const lonSpan = bLonMax - bLonMin

    // HeightmapTerrainData: row 0 = southernmost, row TILE_SIZE-1 = northernmost
    for (let row = 0; row < TILE_SIZE; row++) {
      for (let col = 0; col < TILE_SIZE; col++) {
        // row 0 = south (latMin), row TILE_SIZE-1 = north (latMax)
        const lat = latMin + (row / (TILE_SIZE - 1)) * (latMax - latMin)
        const lon = lonMin + (col / (TILE_SIZE - 1)) * (lonMax - lonMin)

        // Map to array indices
        // Latitude: data goes South-to-North, so index 0 = bLatMin, index nLat-1 = bLatMax
        let si = Math.round(((lat - bLatMin) / latSpan) * (this.nLat - 1))
        // Longitude: data goes West-to-East, index 0 = bLonMin
        let sj = Math.round(((lon - bLonMin) / lonSpan) * (this.nLon - 1))

        // CLAMP to edge values instead of dropping to 0.0!
        // Dropping to 0.0 caused the massive black rectangular cliffs you saw.
        si = Math.max(0, Math.min(this.nLat - 1, si))
        sj = Math.max(0, Math.min(this.nLon - 1, sj))

        buffer[row * TILE_SIZE + col] = this._elev[si * this.nLon + sj]

        buffer[row * TILE_SIZE + col] = this._elev[si * this.nLon + sj]
      }
    }

    return Promise.resolve(new HeightmapTerrainData({
      buffer,
      width:  TILE_SIZE,
      height: TILE_SIZE,
    }))
  }

  getLevelMaximumGeometricError(level) {
    return 100000 / (1 << level)
  }

  getTileDataAvailable() { return true }
}
