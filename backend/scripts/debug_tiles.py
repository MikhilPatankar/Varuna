"""
Debug script: Test tile bbox math and inspect what the backend returns for specific tiles.
Run from: e:\PROJECT\POLARIS\backend
"""
import sys
sys.path.insert(0, '.')

import math
import numpy as np

# ─── Reproduce backend tile math ─────────────────────────────────────────────

def xyz_to_bbox_geographic(x, y, z):
    """Exact copy of current backend tile bbox logic."""
    cols = 2 ** (z + 1)
    rows = 2 ** z
    lon_deg_per_tile = 360.0 / cols
    lat_deg_per_tile = 180.0 / rows
    lon_min = -180.0 + x * lon_deg_per_tile
    lon_max = -180.0 + (x + 1) * lon_deg_per_tile
    lat_max = 90.0 - y * lat_deg_per_tile
    lat_min = 90.0 - (y + 1) * lat_deg_per_tile
    return lat_min, lat_max, lon_min, lon_max


print("=" * 60)
print("CESIUM GEOGRAPHIC TILING SCHEME VERIFICATION")
print("=" * 60)

# Cesium GeographicTilingScheme:
# z=0 → 2 cols × 1 row  (root tiles)
# z=1 → 4 cols × 2 rows
# z=z → 2^(z+1) cols × 2^z rows

for z in [0, 1, 2, 3, 5]:
    cols = 2 ** (z + 1)
    rows = 2 ** z
    print(f"\nZoom {z}: {cols}×{rows} tiles")
    if z <= 2:
        for y in range(rows):
            for x in range(cols):
                lat_min, lat_max, lon_min, lon_max = xyz_to_bbox_geographic(x, y, z)
                print(f"  tile({z},{x},{y}): lat=[{lat_min:.2f},{lat_max:.2f}] lon=[{lon_min:.2f},{lon_max:.2f}]")

print("\n\n")
print("=" * 60)
print("LONGITUDE WRAPPING LOGIC TEST")
print("=" * 60)

# Simulate what happens to lon_centers when wrapping
for z, x, y in [(0,0,0), (0,1,0), (1,2,0), (2,5,1)]:
    lat_min, lat_max, lon_min, lon_max = xyz_to_bbox_geographic(x, y, z)
    lon_step = (lon_max - lon_min) / 256.0
    lat_step = (lat_max - lat_min) / 256.0
    lon_centers = np.linspace(lon_min + lon_step/2, lon_max - lon_step/2, 256)
    lat_centers = np.linspace(lat_max - lat_step/2, lat_min + lat_step/2, 256)

    # Current wrapping logic
    ds_lon_max = 360.0  # CMEMS dataset goes 0..360
    if ds_lon_max > 180:
        lon_wrapped = (lon_centers % 360 + 360) % 360
    else:
        lon_wrapped = ((lon_centers + 180) % 360 + 360) % 360 - 180

    print(f"\ntile({z},{x},{y}):")
    print(f"  bbox: lat=[{lat_min:.2f},{lat_max:.2f}] lon=[{lon_min:.2f},{lon_max:.2f}]")
    print(f"  lon_centers[:5]  = {lon_centers[:5].round(3)}")
    print(f"  lon_wrapped[:5]  = {lon_wrapped[:5].round(3)}")
    print(f"  lat_centers[:5]  = {lat_centers[:5].round(3)}")
    print(f"  ANY NaN in lon_wrapped? {np.any(np.isnan(lon_wrapped))}")


print("\n\n")
print("=" * 60)
print("LOADING ACTUAL TILE FROM ZARR")
print("=" * 60)

try:
    import xarray as xr
    from polaris.config import ZARR_ROOT
    import os

    path = os.path.join(ZARR_ROOT, "temperature", "daily", "2026-09-21.zarr")
    ds = xr.open_zarr(path, consolidated=False)
    ds_isel = ds.isel(time=-1)

    print(f"Dataset coords:")
    print(f"  lat: {float(ds_isel.lat.min()):.3f} to {float(ds_isel.lat.max()):.3f}  ({len(ds_isel.lat)} pts)")
    print(f"  lon: {float(ds_isel.lon.min()):.3f} to {float(ds_isel.lon.max()):.3f}  ({len(ds_isel.lon)} pts)")
    if 'depth' in ds_isel.dims:
        print(f"  depth: {ds_isel.depth.values[:5]}")

    # Test tile z=3, x=4, y=2 (equatorial Atlantic)
    z, x, y = 3, 4, 2
    lat_min, lat_max, lon_min, lon_max = xyz_to_bbox_geographic(x, y, z)
    print(f"\nTesting tile ({z},{x},{y}) → lat=[{lat_min:.2f},{lat_max:.2f}] lon=[{lon_min:.2f},{lon_max:.2f}]")

    lon_step = (lon_max - lon_min) / 256.0
    lat_step = (lat_max - lat_min) / 256.0
    lon_centers = np.linspace(lon_min + lon_step/2, lon_max - lon_step/2, 256)
    lat_centers = np.linspace(lat_max - lat_step/2, lat_min + lat_step/2, 256)

    ds_lon_max_val = float(ds_isel.lon.max())
    if ds_lon_max_val > 180:
        lon_wrapped = (lon_centers % 360 + 360) % 360
    else:
        lon_wrapped = ((lon_centers + 180) % 360 + 360) % 360 - 180

    lon_da = xr.DataArray(lon_wrapped, dims='x')
    lat_da = xr.DataArray(lat_centers, dims='y')

    data_surface = ds_isel['temperature'].sel(depth=0, method='nearest').sel(lat=lat_da, lon=lon_da, method='nearest')
    vals = data_surface.values
    print(f"  Result shape: {vals.shape}")
    print(f"  dtype: {vals.dtype}")
    print(f"  NaN count: {np.sum(np.isnan(vals))} / {vals.size}")
    print(f"  Value range: {float(np.nanmin(vals)):.2f} to {float(np.nanmax(vals)):.2f}")
    print(f"  Expected shape: (256, 256)")

    if vals.shape != (256, 256):
        print(f"\n*** SHAPE MISMATCH! Got {vals.shape} instead of (256, 256) ***")
        print("This is the root cause of the banding!")
    else:
        print("\n✓ Shape is correct (256, 256)")

except Exception as e:
    print(f"ERROR loading zarr: {e}")
    import traceback
    traceback.print_exc()

print("\n\n")
print("=" * 60)
print("CONCURRENT TILE ACCESS (SHARED CANVAS BUG CHECK)")
print("=" * 60)
print("""
IMPORTANT - Check OceanTileProvider.js:
  
  The frontend uses 'window.oceanSharedCanvas' for ALL tiles.
  Multiple tiles load IN PARALLEL (async). This means:
  
  Tile-A: await img.load() → 
  Tile-B: await img.load() →  (both finish around same time)
  Tile-A: ctx.drawImage(imgA) → 
  Tile-B: ctx.drawImage(imgB) → OVERWRITES Tile-A's canvas!
  Tile-A: getImageData() → returns Tile-B's data!!
  
  This is the RACE CONDITION causing tile corruption.
""")
