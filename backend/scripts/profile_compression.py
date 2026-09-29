"""
Profile compression strategies to reduce tile size without dropping depth levels.
Also analyze what multi-tile LOD at zoom 2-3 would look like.
"""
import sys, os, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import numpy as np
import xarray as xr
from polaris.config import ZARR_ROOT
from pathlib import Path

variable = 'temperature'
tier = 'daily'
time_key = '2026-09-21'

zarr_path = Path(ZARR_ROOT) / variable / tier / f"{time_key}.zarr"
print(f"Loading dataset...")
ds = xr.open_zarr(str(zarr_path), consolidated=True).load()
if 'time' in ds.dims:
    ds = ds.isel(time=-1)

print(f"Dataset shape: {ds[variable].shape}")
print(f"Dims: {ds[variable].dims}")

# ── Build the z=0 tile (full globe, 256x256) ──────────────────────────
lat_centers = np.linspace(89.65, -89.65, 256)
lon_centers = np.linspace(-179.96, 179.96, 256)

lat_indices = np.abs(ds.lat.values[:, None] - lat_centers).argmin(axis=0)
lon_indices = np.abs(ds.lon.values[:, None] - lon_centers).argmin(axis=0)

raw = ds[variable].values  # (depth, lat, lon)
tile_data = raw[np.ix_(np.arange(raw.shape[0]), lat_indices, lon_indices)]  # (48, 256, 256)

vmin = float(np.nanmin(tile_data))
vmax = float(np.nanmax(tile_data))
print(f"\nTile shape: {tile_data.shape}, vmin={vmin:.2f}, vmax={vmax:.2f}")

nan_mask = np.isnan(tile_data)
clean = np.nan_to_num(tile_data, nan=vmin)
clean = np.clip(clean, vmin, vmax)

quantized = np.clip((clean - vmin) / (vmax - vmin) * 254.0 + 1.0, 1.0, 255.0).astype(np.uint8)
quantized[nan_mask] = 0

raw_bytes = quantized.tobytes()
print(f"Raw tile: {len(raw_bytes)} bytes ({len(raw_bytes)/1024:.0f} KB)")

# ═══════════════════════════════════════════════════════════════════════
# COMPRESSION STRATEGY COMPARISON
# ═══════════════════════════════════════════════════════════════════════

import gzip, zlib

print("\n" + "="*70)
print("STRATEGY 1: Plain gzip (current)")
print("="*70)
for level in [1, 6]:
    t0 = time.time()
    c = gzip.compress(raw_bytes, compresslevel=level)
    dt = time.time() - t0
    print(f"  gzip-{level}: {len(c)/1024:.0f} KB  ({dt*1000:.0f}ms)")

# ── Delta encoding along depth ─────────────────────────────────────────
print("\n" + "="*70)
print("STRATEGY 2: Delta encoding along depth axis")
print("  (store surface absolute, each deeper layer as diff from previous)")
print("="*70)

# Analyze the actual deltas
deltas = np.diff(quantized.astype(np.int16), axis=0)  # (47, 256, 256)
print(f"  Delta range: [{deltas.min()}, {deltas.max()}]")
print(f"  Delta mean abs: {np.mean(np.abs(deltas)):.1f}")
print(f"  Delta std: {np.std(deltas):.1f}")
print(f"  Zeros in deltas: {(deltas == 0).sum() / deltas.size * 100:.1f}%")

# Encode: first layer absolute (uint8), remaining as int8 deltas clamped to [-127, 127]
first_layer = quantized[0]  # (256, 256), uint8
delta_layers = np.clip(deltas, -127, 127).astype(np.int8)  # (47, 256, 256)
delta_bytes = first_layer.tobytes() + delta_layers.tobytes()

for level in [1, 6]:
    t0 = time.time()
    c = gzip.compress(delta_bytes, compresslevel=level)
    dt = time.time() - t0
    print(f"  delta+gzip-{level}: {len(c)/1024:.0f} KB  ({dt*1000:.0f}ms)")

# ── zlib (slightly less overhead than gzip) ────────────────────────────
print("\n" + "="*70)
print("STRATEGY 3: Delta + zlib")
print("="*70)
for level in [1, 6]:
    t0 = time.time()
    c = zlib.compress(delta_bytes, level=level)
    dt = time.time() - t0
    print(f"  delta+zlib-{level}: {len(c)/1024:.0f} KB  ({dt*1000:.0f}ms)")

# ── Reorder memory layout: depth-last instead of depth-first ──────────
print("\n" + "="*70)
print("STRATEGY 4: Transpose to (lat, lon, depth) for better spatial locality")
print("="*70)
transposed = quantized.transpose(1, 2, 0)  # (256, 256, 48) → depth-last
trans_bytes = transposed.tobytes()
for level in [1, 6]:
    t0 = time.time()
    c = gzip.compress(trans_bytes, compresslevel=level)
    dt = time.time() - t0
    print(f"  transposed+gzip-{level}: {len(c)/1024:.0f} KB  ({dt*1000:.0f}ms)")

# Delta on transposed
trans_deltas = np.diff(transposed.astype(np.int16), axis=2)
trans_first = transposed[:,:,0]
trans_delta_layers = np.clip(trans_deltas, -127, 127).astype(np.int8)
trans_delta_bytes = trans_first.tobytes() + trans_delta_layers.tobytes()
for level in [1, 6]:
    t0 = time.time()
    c = gzip.compress(trans_delta_bytes, compresslevel=level)
    dt = time.time() - t0
    print(f"  transposed+delta+gzip-{level}: {len(c)/1024:.0f} KB  ({dt*1000:.0f}ms)")

# ── Separate land mask from data ──────────────────────────────────────
print("\n" + "="*70)
print("STRATEGY 5: Separate land mask (1-bit) + data-only compression")
print("="*70)
# Land mask is highly compressible (large contiguous regions)
land_mask = (quantized[0] == 0).astype(np.uint8)  # same for all depths
# Pack 8 pixels per byte
mask_packed = np.packbits(land_mask)
mask_gz = gzip.compress(mask_packed.tobytes(), compresslevel=1)
print(f"  Land mask: {len(mask_packed)} bytes raw -> {len(mask_gz)} bytes gzip ({len(mask_gz)/1024:.1f} KB)")

# For data: replace land (0) with nearest-neighbor to improve compression
# (removes the 0-to-value transitions that hurt compression)
padded = quantized.copy()
for _ in range(2):
    for axis in [1, 2]:
        shifted_fwd = np.roll(padded, 1, axis=axis)
        shifted_bwd = np.roll(padded, -1, axis=axis)
        fill_mask = (padded == 0) & ((shifted_fwd > 0) | (shifted_bwd > 0))
        fill_vals = np.maximum(shifted_fwd, shifted_bwd)
        padded[fill_mask] = fill_vals[fill_mask]

padded_delta = np.diff(padded.astype(np.int16), axis=0)
padded_first = padded[0]
padded_delta_clamped = np.clip(padded_delta, -127, 127).astype(np.int8)
padded_combined = padded_first.tobytes() + padded_delta_clamped.tobytes()

for level in [1, 6]:
    c_data = gzip.compress(padded_combined, compresslevel=level)
    total = len(mask_gz) + len(c_data)
    print(f"  padded+delta+mask gzip-{level}: {total/1024:.0f} KB  (mask:{len(mask_gz)/1024:.1f}KB + data:{len(c_data)/1024:.0f}KB)")

# ═══════════════════════════════════════════════════════════════════════
# MULTI-TILE LOD ANALYSIS
# ═══════════════════════════════════════════════════════════════════════
print("\n" + "="*70)
print("MULTI-TILE LOD: Size per tile at different zoom levels")
print("="*70)

def xyz_to_bbox(x, y, z):
    cols = 2 ** (z + 1)
    rows = 2 ** z
    lon_min = -180.0 + x * 360.0 / cols
    lon_max = -180.0 + (x + 1) * 360.0 / cols
    lat_max = 90.0 - y * 180.0 / rows
    lat_min = 90.0 - (y + 1) * 180.0 / rows
    return lat_min, lat_max, lon_min, lon_max

for zoom in [0, 1, 2, 3]:
    cols = 2 ** (zoom + 1)
    rows = 2 ** zoom
    total_tiles = cols * rows
    
    # Sample a tile near India (interesting data)
    mid_x = cols // 2 + cols // 4  # roughly 90°E
    mid_y = rows // 4              # roughly 45°N
    mid_x = min(mid_x, cols - 1)
    mid_y = min(mid_y, rows - 1)
    
    lat_min, lat_max, lon_min, lon_max = xyz_to_bbox(mid_x, mid_y, zoom)
    
    lon_step = (lon_max - lon_min) / 256.0
    lat_step = (lat_max - lat_min) / 256.0
    lc = np.linspace(lon_min + lon_step/2, lon_max - lon_step/2, 256)
    ltc = np.linspace(lat_min + lat_step/2, lat_max - lat_step/2, 256)
    
    lc = np.clip(lc, float(ds.lon.values.min()), float(ds.lon.values.max()))
    
    li = np.abs(ds.lat.values[:, None] - ltc).argmin(axis=0)
    loi = np.abs(ds.lon.values[:, None] - lc).argmin(axis=0)
    
    tile = raw[np.ix_(np.arange(raw.shape[0]), li, loi)]
    nm = np.isnan(tile)
    tc = np.nan_to_num(tile, nan=vmin)
    tc = np.clip(tc, vmin, vmax)
    tq = np.clip((tc - vmin) / (vmax - vmin) * 254.0 + 1.0, 1.0, 255.0).astype(np.uint8)
    tq[nm] = 0
    
    # Best compression: delta + gzip
    td = np.diff(tq.astype(np.int16), axis=0)
    td_clamped = np.clip(td, -127, 127).astype(np.int8)
    combined = tq[0].tobytes() + td_clamped.tobytes()
    compressed = gzip.compress(combined, compresslevel=6)
    plain_gz = gzip.compress(tq.tobytes(), compresslevel=6)
    
    land_pct = nm[0].sum() / nm[0].size * 100
    deg_per_px = (lon_max - lon_min) / 256.0
    
    print(f"\n  Zoom {zoom}: {total_tiles} tiles, {cols}×{rows} grid")
    print(f"    Coverage: {lat_min:.1f}°-{lat_max:.1f}° lat, {lon_min:.1f}°-{lon_max:.1f}° lon")
    print(f"    Resolution: {deg_per_px:.3f}°/px ({deg_per_px*111:.1f} km/px)")
    print(f"    Land%: {land_pct:.0f}%")
    print(f"    Plain gzip:    {len(plain_gz)/1024:.0f} KB")
    print(f"    Delta+gzip:    {len(compressed)/1024:.0f} KB")
    print(f"    Unique depth vals per pixel: {len(np.unique(li))} lat × {len(np.unique(loi))} lon")

# Summary table
print("\n" + "="*70)
print("SUMMARY: Best approach for target 500-700KB")
print("="*70)
