"""
render_bathymetry_preview.py
============================
Pre-renders the global CMEMS bathymetry depth data into a compressed WebP image
and saves it to frontend/public/bathymetry.webp.

After running this once, the frontend loads this as a static file (~2MB) directly
into Cesium — NO 35MB API fetch, NO JS canvas rendering, NO WebP encoding in browser.

Usage (from project root, using the venv):
    cd backend
    venv\\Scripts\\python scripts\\render_bathymetry_preview.py
"""

import sys
import numpy as np
from pathlib import Path

# ── Path setup ────────────────────────────────────────────────────────────────
SCRIPT_DIR      = Path(__file__).resolve().parent
BACKEND_DIR     = SCRIPT_DIR.parent
PROJECT_ROOT    = BACKEND_DIR.parent
FRONTEND_PUBLIC = PROJECT_ROOT / "frontend" / "public"
OUTPUT_PATH     = FRONTEND_PUBLIC / "bathymetry.webp"

sys.path.insert(0, str(BACKEND_DIR))
from polaris.config import ZARR_ROOT

# ── Load data ─────────────────────────────────────────────────────────────────
zarr_path = Path(ZARR_ROOT) / "bathymetry" / "static" / "static.zarr"
print(f"[1/4] Loading Zarr from: {zarr_path}")

try:
    import xarray as xr
    ds = xr.open_zarr(str(zarr_path), consolidated=True).load()
    var = list(ds.data_vars)[0]
    raw = ds[var].values.astype(np.float32)
    print(f"      Variable: '{var}', shape: {raw.shape}")
except Exception as e:
    print(f"ERROR loading Zarr: {e}")
    sys.exit(1)

# ── Apply 25-stop colormap ────────────────────────────────────────────────────
# CMEMS deptho convention: positive = metres below sea level, NaN/<=0 = land
# We flip to negative = ocean depth
print("[2/4] Applying 25-stop ocean depth colormap...")

raw_depth = raw.astype(np.float64)
# Positive CMEMS values are depth below surface → make them negative for our shader convention
ocean_mask_raw = (raw_depth > 0) & (~np.isnan(raw_depth))
elev = np.where(ocean_mask_raw, -raw_depth, 0.0)
nLat, nLon = elev.shape

# ── 25-stop gradient ──────────────────────────────────────────────────────────
# Designed for CMEMS 50+ depth levels (0m surface → 6000m+ hadal zone)
# Each stop is (t, R, G, B) where t is normalised depth 0=surface, 1=6000m
# The gradient is heavily weighted towards darkness in the deep zones.
STOPS = np.array([
    # t      R      G      B     — zone description
    [0.00,  0.62,  0.92,  0.96],  # 0m       sunlit surface (bright cyan)
    [0.02,  0.52,  0.84,  0.93],  # 120m     shelf wash
    [0.04,  0.44,  0.76,  0.90],  # 240m     euphotic base
    [0.07,  0.37,  0.68,  0.87],  # 420m     twilight zone top
    [0.10,  0.31,  0.60,  0.84],  # 600m     mesopelagic
    [0.13,  0.26,  0.54,  0.80],  # 780m     mesopelagic mid
    [0.17,  0.22,  0.47,  0.75],  # 1020m    midnight zone entry
    [0.21,  0.19,  0.41,  0.70],  # 1260m    bathypelagic
    [0.25,  0.17,  0.36,  0.65],  # 1500m    bathypelagic mid
    [0.30,  0.15,  0.32,  0.60],  # 1800m    deep bathypelagic
    [0.35,  0.13,  0.27,  0.55],  # 2100m    lower bathypelagic
    [0.40,  0.12,  0.23,  0.50],  # 2400m    abyssopelagic entry
    [0.45,  0.11,  0.20,  0.45],  # 2700m    abyssal upper
    [0.50,  0.10,  0.17,  0.41],  # 3000m    abyssal mid
    [0.55,  0.09,  0.15,  0.37],  # 3300m    abyssal deep
    [0.60,  0.08,  0.13,  0.33],  # 3600m    abyssal plain
    [0.65,  0.07,  0.11,  0.29],  # 3900m    lower abyssal
    [0.70,  0.06,  0.10,  0.25],  # 4200m    deep abyssal
    [0.75,  0.06,  0.08,  0.21],  # 4500m    very deep abyssal
    [0.80,  0.05,  0.07,  0.18],  # 4800m    near-hadal
    [0.85,  0.04,  0.06,  0.15],  # 5100m    hadal zone
    [0.88,  0.04,  0.05,  0.12],  # 5280m    hadal deep
    [0.92,  0.03,  0.04,  0.10],  # 5520m    ultra-deep
    [0.96,  0.02,  0.04,  0.08],  # 5760m    near-trench
    [1.00,  0.02,  0.03,  0.06],  # 6000m+   trench floor (near-black)
], dtype=np.float64)

t_stops = STOPS[:, 0]
c_stops = STOPS[:, 1:]  # (25, 3)

# Normalised depth per pixel
t = np.clip(-elev / 6000.0, 0.0, 1.0)  # shape (nLat, nLon)

# Vectorised piecewise linear interpolation across 25 stops
# Find which segment each pixel falls in using searchsorted
seg = np.searchsorted(t_stops, t, side='right') - 1
seg = np.clip(seg, 0, len(t_stops) - 2)

t_lo = t_stops[seg]
t_hi = t_stops[seg + 1]
dt   = np.where((t_hi - t_lo) > 1e-10, (t - t_lo) / (t_hi - t_lo), 0.0)

c_lo = c_stops[seg]                    # (nLat, nLon, 3)
c_hi = c_stops[seg + 1]
col  = c_lo + dt[..., np.newaxis] * (c_hi - c_lo)

# Subtle atmospheric scattering: pale sky-blue haze only in the shallowest 15%
HAZE       = np.array([0.70, 0.88, 0.98])
haze_str   = np.clip(0.30 * (1.0 - t / 0.15), 0.0, 0.30)[..., np.newaxis]
col        = np.clip(col + haze_str * (HAZE - col), 0.0, 1.0)

# Alpha: shallow water semi-transparent → deep water fully opaque
alpha = np.clip(0.60 + 0.40 * (t ** 1.5), 0.0, 1.0)  # power 1.5 = faster deepening

# Build RGBA (pre-multiplied alpha for WebP)
rgba = np.zeros((nLat, nLon, 4), dtype=np.uint8)
ocean_mask = elev < -1.0   # exclude spurious near-zero ocean noise

rgba[ocean_mask, 0] = np.clip(col[ocean_mask, 0] * alpha[ocean_mask] * 255, 0, 255).astype(np.uint8)
rgba[ocean_mask, 1] = np.clip(col[ocean_mask, 1] * alpha[ocean_mask] * 255, 0, 255).astype(np.uint8)
rgba[ocean_mask, 2] = np.clip(col[ocean_mask, 2] * alpha[ocean_mask] * 255, 0, 255).astype(np.uint8)
rgba[ocean_mask, 3] = np.clip(alpha[ocean_mask] * 255, 0, 255).astype(np.uint8)
# Land/shallow-land pixels stay fully transparent (rgba = 0,0,0,0)

# Flip vertically: CMEMS data is South-to-North, but images are Top-to-Bottom (North-to-South)
rgba = np.flipud(rgba)

# ── Write WebP ────────────────────────────────────────────────────────────────
print(f"[3/4] Encoding to WebP (quality=88)...")
try:
    from PIL import Image
    img = Image.fromarray(rgba, mode='RGBA')
    FRONTEND_PUBLIC.mkdir(parents=True, exist_ok=True)
    img.save(str(OUTPUT_PATH), format='WEBP', quality=88, lossless=False)
    size_mb = OUTPUT_PATH.stat().st_size / (1024 * 1024)
    print(f"      Saved:  {OUTPUT_PATH}")
    print(f"      Size:   {size_mb:.2f} MB  (was 35 MB raw float32)")
except ImportError:
    print("ERROR: Pillow is not installed.  pip install Pillow")
    sys.exit(1)

# ── Write metadata sidecar ────────────────────────────────────────────────────
import json
lats = ds['lat'].values if 'lat' in ds.coords else ds['latitude'].values
lons = ds['lon'].values if 'lon' in ds.coords else ds['longitude'].values
meta = {
    "lat_min": float(lats.min()),
    "lat_max": float(lats.max()),
    "lon_min": float(lons.min()),
    "lon_max": float(lons.max()),
    "width":   int(nLon),
    "height":  int(nLat),
    "stops":   25,
    "size_mb": round(size_mb, 2),
}
meta_path = FRONTEND_PUBLIC / "bathymetry_meta.json"
meta_path.write_text(json.dumps(meta, indent=2))
print(f"[4/4] Metadata written: {meta_path}")
print(f"\nDone! {size_mb:.2f} MB written (35x smaller than raw)")
