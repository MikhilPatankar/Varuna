import {
    Event,
    GeographicTilingScheme
} from 'cesium';

export class OceanTileProvider {
    constructor(options) {
        this.urlTemplate = options.url;
        this.tilingScheme = new GeographicTilingScheme();
        this.tileWidth = 256;
        this.tileHeight = 256;
        this.minimumLevel = 0;
        this.maximumLevel = options.maximumLevel || 10;
        this.rectangle = this.tilingScheme.rectangle;
        this.errorEvent = new Event();
        this.ready = true;
        this.readyPromise = Promise.resolve(true);
        this.hasAlphaChannel = true;

        // Fixed bounds for tile URL — static URL = browser caches tiles!
        this.encodingVmin = options.encodingVmin !== undefined ? options.encodingVmin : -5;
        this.encodingVmax = options.encodingVmax !== undefined ? options.encodingVmax : 45;

        // Dynamic display bounds — changed by UI sliders, no new network requests
        this.displayVmin = options.vmin !== undefined ? options.vmin : 0;
        this.displayVmax = options.vmax !== undefined ? options.vmax : 35;
        this.colormapName = options.colormap || 'turbo';
        this.opacity = options.opacity !== undefined ? options.opacity : 1.0;

        // Pre-baked 32-bit LUT: one lookup = full RGBA pixel
        this.lut = new Uint8Array(256 * 4);
        this.lut32 = new Uint32Array(this.lut.buffer);
        this._buildLUT();
    }

    _buildLUT() {
        for (let i = 0; i < 256; i++) {
            const t = i / 255.0;
            const r = Math.max(0, Math.min(255, Math.floor((1.5 - Math.abs(t * 4 - 3)) * 255)));
            const g = Math.max(0, Math.min(255, Math.floor((1.5 - Math.abs(t * 4 - 2)) * 255)));
            const b = Math.max(0, Math.min(255, Math.floor((1.5 - Math.abs(t * 4 - 1)) * 255)));
            const a = Math.floor(255 * this.opacity);
            // Pack as little-endian RGBA in a Uint32
            this.lut32[i] = (a << 24) | (b << 16) | (g << 8) | r;
        }
    }

    updateSettings({ vmin, vmax, colormap, opacity }) {
        let changed = false;
        if (vmin !== undefined && vmin !== this.displayVmin) { this.displayVmin = vmin; changed = true; }
        if (vmax !== undefined && vmax !== this.displayVmax) { this.displayVmax = vmax; changed = true; }
        if (colormap !== undefined && this.colormapName !== colormap) { this.colormapName = colormap; changed = true; }
        if (opacity !== undefined && opacity !== this.opacity) { this.opacity = opacity; changed = true; }
        if (changed) this._buildLUT();
        return changed;
    }

    getTileCredits() { return []; }

    async requestImage(x, y, level) {
        const url = this.urlTemplate
            .replace('{z}', level)
            .replace('{x}', x)
            .replace('{y}', y);

        try {
            // Fetch as blob — more reliable than new Image() for cross-origin tiles
            const res = await fetch(url);
            if (!res.ok) return undefined;
            const blob = await res.blob();

            // Decode PNG into raw pixels
            const rawBitmap = await createImageBitmap(blob);

            // *** KEY FIX: each tile gets its own OffscreenCanvas ***
            // window.oceanSharedCanvas caused a race condition: parallel tile loads
            // overwrote each other's canvas data, producing the banding corruption!
            const offscreen = new OffscreenCanvas(rawBitmap.width, rawBitmap.height);
            const ctx = offscreen.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(rawBitmap, 0, 0);
            rawBitmap.close(); // release GPU memory immediately

            const imgData = ctx.getImageData(0, 0, offscreen.width, offscreen.height);
            const view32 = new Uint32Array(imgData.data.buffer);

            // Read the dynamic min/max scale that the backend used for this specific tile
            const tileVmin = parseFloat(res.headers.get('X-Value-Min') || this.encodingVmin);
            const tileVmax = parseFloat(res.headers.get('X-Value-Max') || this.encodingVmax);

            const inv16777215 = 1.0 / 16777215.0;
            const valueRange = tileVmax - tileVmin;
            const invDisplayRange = 255.0 / Math.max(0.001, this.displayVmax - this.displayVmin);

            for (let i = 0; i < view32.length; i++) {
                const pixel = view32[i];
                // ImageData is always little-endian: pixel = 0xAABBGGRR
                if ((pixel >>> 24) === 0) continue; // transparent = land/NaN

                const r = pixel & 0xFF;
                const g = (pixel >>> 8) & 0xFF;
                const b = (pixel >>> 16) & 0xFF;

                // Decode Terrain-RGB -> actual data value using the dynamic tile bounds
                const encoded = (r << 16) | (g << 8) | b;
                const actualValue = tileVmin + (encoded * inv16777215) * valueRange;

                // Map to colormap LUT index
                let lutIdx = Math.floor((actualValue - this.displayVmin) * invDisplayRange);
                lutIdx = lutIdx < 0 ? 0 : (lutIdx > 255 ? 255 : lutIdx);

                view32[i] = this.lut32[lutIdx];
            }

            // ImageBitmap: GPU-optimised, non-blocking upload to Cesium WebGL
            return await createImageBitmap(imgData);
        } catch (e) {
            console.warn(`[OceanTileProvider] tile ${level}/${x}/${y} failed:`, e);
            return undefined;
        }
    }
}
