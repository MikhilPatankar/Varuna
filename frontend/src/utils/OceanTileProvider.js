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
        
        this.colormapSettings = options.colormapSettings || {
            colors: ['#000080', '#0000ff', '#00ffff', '#ffff00', '#ff0000'],
            inverted: false,
            stepwise: false,
            steps: 5
        };
        this.opacity = options.opacity !== undefined ? options.opacity : 1.0;

        // Pre-baked 32-bit LUT: one lookup = full RGBA pixel
        this.lut = new Uint8Array(256 * 4);
        this.lut32 = new Uint32Array(this.lut.buffer);
        this._buildLUT();
    }

    _buildLUT() {
        const parseHex = (hex) => {
            const clean = hex.replace('#', '');
            if (clean.length === 3) {
                return [
                    parseInt(clean[0]+clean[0], 16),
                    parseInt(clean[1]+clean[1], 16),
                    parseInt(clean[2]+clean[2], 16)
                ];
            }
            return [
                parseInt(clean.substring(0,2), 16),
                parseInt(clean.substring(2,4), 16),
                parseInt(clean.substring(4,6), 16)
            ];
        };

        const colors = this.colormapSettings.colors || ['#000080', '#0000ff', '#00ffff', '#ffff00', '#ff0000'];
        const c1 = parseHex(colors[0] || '#000000');
        const c2 = parseHex(colors[1] || '#000000');
        const c3 = parseHex(colors[2] || '#000000');
        const c4 = parseHex(colors[3] || '#000000');
        const c5 = parseHex(colors[4] || '#000000');
        
        const stepwise = this.colormapSettings.stepwise;
        const stepsCount = this.colormapSettings.steps || 5;
        const masked = this.colormapSettings.masked;
        const maskOutline = this.colormapSettings.maskOutline !== undefined ? this.colormapSettings.maskOutline : 1.5;
        
        const maskThreshold = masked ? Math.floor((maskOutline / 2 / 100) * 256) : 0;

        for (let i = 0; i < 256; i++) {
            if (masked && (i < maskThreshold || i >= 256 - maskThreshold)) {
                // For the masked/outlined, make it completely black
                const a = Math.floor(255 * this.opacity);
                this.lut32[i] = (a << 24) | (0 << 16) | (0 << 8) | 0;
                continue;
            }

            let t = i / 255.0;
            
            if (stepwise) {
                t = Math.floor(t * stepsCount) / Math.max(1, stepsCount - 1);
                if (t > 1.0) t = 1.0;
            }

            let r, g, b;
            if (t < 0.25) {
                const f = t * 4.0;
                r = c1[0] + (c2[0] - c1[0]) * f;
                g = c1[1] + (c2[1] - c1[1]) * f;
                b = c1[2] + (c2[2] - c1[2]) * f;
            } else if (t < 0.5) {
                const f = (t - 0.25) * 4.0;
                r = c2[0] + (c3[0] - c2[0]) * f;
                g = c2[1] + (c3[1] - c2[1]) * f;
                b = c2[2] + (c3[2] - c2[2]) * f;
            } else if (t < 0.75) {
                const f = (t - 0.5) * 4.0;
                r = c3[0] + (c4[0] - c3[0]) * f;
                g = c3[1] + (c4[1] - c3[1]) * f;
                b = c3[2] + (c4[2] - c3[2]) * f;
            } else {
                const f = (t - 0.75) * 4.0;
                r = c4[0] + (c5[0] - c4[0]) * f;
                g = c4[1] + (c5[1] - c4[1]) * f;
                b = c4[2] + (c5[2] - c4[2]) * f;
            }

            r = Math.max(0, Math.min(255, Math.round(r)));
            g = Math.max(0, Math.min(255, Math.round(g)));
            b = Math.max(0, Math.min(255, Math.round(b)));
            const a = Math.floor(255 * this.opacity);
            
            this.lut32[i] = (a << 24) | (b << 16) | (g << 8) | r;
        }
    }

    updateSettings({ vmin, vmax, colormapSettings, opacity }) {
        let changed = false;
        if (vmin !== undefined && vmin !== this.displayVmin) { this.displayVmin = vmin; changed = true; }
        if (vmax !== undefined && vmax !== this.displayVmax) { this.displayVmax = vmax; changed = true; }
        if (colormapSettings !== undefined) {
            this.colormapSettings = colormapSettings;
            changed = true;
        }
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
