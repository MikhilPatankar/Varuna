"""Profile the tile generation pipeline to find the bottleneck."""
import sys, os, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import numpy as np
import xarray as xr
from polaris.config import ZARR_ROOT
from pathlib import Path

variable = 'temperature'
tier = 'daily'
time_key = '2026-09-21'
z, x, y = 0, 0, 0

zarr_path = Path(ZARR_ROOT) / variable / tier / f"{time_key}.zarr"
print(f"Zarr path: {zarr_path}")
print(f"Exists: {zarr_path.exists()}")

# Step 1: Open zarr (lazy)
t0 = time.time()
ds = xr.open_zarr(str(zarr_path), consolidated=True)
t_open = time.time() - t0
print(f"\n1. xr.open_zarr (lazy): {t_open*1000:.1f}ms")

# Check the data variable info
da = ds[variable]
print(f"   Shape: {da.shape}, Chunks: {da.encoding.get('chunks', 'N/A')}")
print(f"   Dims: {da.dims}")

# Step 2: .load() into RAM
t1 = time.time()
ds.load()
t_load = time.time() - t1
print(f"\n2. ds.load() into RAM: {t_load*1000:.1f}ms ({t_load:.1f}s)")

if 'time' in ds.dims:
    ds = ds.isel(time=-1)

# Step 3: Compute lat/lon indices
lat_min, lat_max, lon_min, lon_max = -90.0, 90.0, -180.0, 180.0
lon_step = (lon_max - lon_min) / 256.0
lat_step = (lat_max - lat_min) / 256.0
lon_centers = np.linspace(lon_min + lon_step/2, lon_max - lon_step/2, 256)
lat_centers = np.linspace(lat_min + lat_step/2, lat_max - lat_step/2, 256)

ds_lon_min = float(np.nanmin(ds.lon.values))
ds_lon_max_val = float(np.nanmax(ds.lon.values))
lon_centers = np.clip(lon_centers, ds_lon_min, ds_lon_max_val)

t2 = time.time()
lat_indices = np.abs(ds.lat.values[:, None] - lat_centers).argmin(axis=0)
lon_indices = np.abs(ds.lon.values[:, None] - lon_centers).argmin(axis=0)
t_indices = time.time() - t2
print(f"\n3. Compute lat/lon indices: {t_indices*1000:.1f}ms")

# Step 4: .isel() with advanced indexing
t3 = time.time()
data = ds[variable].isel(lat=lat_indices, lon=lon_indices)
t_isel = time.time() - t3
print(f"\n4. .isel(lat=arr, lon=arr): {t_isel*1000:.1f}ms")

# Step 5: .values (materialize)
t4 = time.time()
values = data.values.astype(np.float32)
t_values = time.time() - t4
print(f"\n5. data.values.astype(float32): {t_values*1000:.1f}ms")
print(f"   Shape: {values.shape}")

# Step 6: Quantize
vmin = float(np.nanmin(values))
vmax = float(np.nanmax(values))
nan_mask = np.isnan(values)
values_clean = np.nan_to_num(values, nan=vmin)
values_clean = np.clip(values_clean, vmin, vmax)

t5 = time.time()
quantized = np.clip(
    (values_clean - vmin) / (vmax - vmin) * 254.0 + 1.0, 1.0, 255.0
).astype(np.uint8)
quantized[nan_mask] = 0
t_quant = time.time() - t5
print(f"\n6. Quantize to uint8: {t_quant*1000:.1f}ms")

# Step 7: gzip compress
import gzip
raw_bytes = quantized.tobytes()
print(f"\n   Raw size: {len(raw_bytes) / 1024:.1f} KB ({len(raw_bytes) / 1024 / 1024:.2f} MB)")

for level in [1, 3, 6, 9]:
    t6 = time.time()
    compressed = gzip.compress(raw_bytes, compresslevel=level)
    t_gz = time.time() - t6
    print(f"   gzip level={level}: {len(compressed)/1024:.1f} KB in {t_gz*1000:.1f}ms (ratio: {len(raw_bytes)/len(compressed):.1f}x)")

# Step 8: Try alternative — numpy-based approach instead of xarray isel
print("\n--- Alternative: Pure NumPy indexing ---")
# Get raw numpy array
raw = ds[variable].values  # already loaded, shape: (depth, lat, lon)
print(f"   Raw array shape: {raw.shape}")

t7 = time.time()
result = raw[:, lat_indices, :][:, :, lon_indices]
t_np = time.time() - t7
print(f"   NumPy fancy indexing: {t_np*1000:.1f}ms, shape: {result.shape}")

# But wait — that does outer indexing. For paired indexing we need np.ix_ or direct
t8 = time.time()
result2 = raw[np.ix_(np.arange(raw.shape[0]), lat_indices, lon_indices)]
t_np2 = time.time() - t8
print(f"   NumPy ix_ indexing: {t_np2*1000:.1f}ms, shape: {result2.shape}")

# Fastest: direct loop-free with take
t9 = time.time()
# For each depth, select lat rows then lon cols
temp = raw[:, lat_indices, :]  # (depth, 256, full_lon)
result3 = temp[:, :, lon_indices]  # (depth, 256, 256)
t_np3 = time.time() - t9
print(f"   NumPy chained take: {t_np3*1000:.1f}ms, shape: {result3.shape}")

print("\n=== TOTAL PIPELINE (post-cache) ===")
total = t_indices + t_isel + t_values + t_quant
print(f"   xarray path: {total*1000:.1f}ms")
total_np = t_indices + t_np3
print(f"   numpy path:  {(total_np)*1000:.1f}ms")

print(f"\n=== FIRST-TIME LOAD (cold start) ===")
print(f"   {(t_open + t_load)*1000:.1f}ms ({t_open + t_load:.1f}s)")
