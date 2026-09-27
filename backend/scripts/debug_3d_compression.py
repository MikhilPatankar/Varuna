import time
import numpy as np
import xarray as xr
from polaris.config import ZARR_ROOT
import os
import zlib

path = os.path.join(ZARR_ROOT, "temperature", "daily", "2026-09-21.zarr")
ds = xr.open_zarr(path, consolidated=False).isel(time=-1).load()

lon_min, lon_max = -180.0, -90.0
lat_min, lat_max = 0.0, 90.0
lon_step = (lon_max - lon_min) / 256.0
lat_step = (lat_max - lat_min) / 256.0

lon_centers = np.linspace(lon_min + lon_step/2, lon_max - lon_step/2, 256)
lat_centers = np.linspace(lat_min + lat_step/2, lat_max - lat_step/2, 256)
lon_da = xr.DataArray(lon_centers, dims='x')
lat_da = xr.DataArray(lat_centers, dims='y')

data = ds['temperature'].sel(lat=lat_da, lon=lon_da, method='nearest')
values = data.values.astype(np.float32)
values = np.nan_to_num(values, nan=-99.0)

print(f"Original Volume: {values.shape}")

# Strategy 1: UInt8 Quantization (0-255)
# If temperature range is -5 to 35, 255 steps = 0.15°C resolution (visually perfect)
t0 = time.time()
vmin, vmax = -5.0, 35.0
nan_mask = (values == -99.0)
quantized = np.clip((values - vmin) / (vmax - vmin) * 255.0, 0, 255).astype(np.uint8)
quantized[nan_mask] = 0 # Reserve 0 for NaN/Land
zlib_uint8 = zlib.compress(quantized.tobytes(), level=6)
print(f"Strategy 1 (UInt8 256x256x50 + Zlib): {len(zlib_uint8)/1024:.2f} KB | Time: {time.time()-t0:.4f}s")

# Strategy 2: 128x128 Horizontal Subsampling + UInt8
# 3D Volumes rarely need crisp 256x256 horizontal edges.
t0 = time.time()
subsampled = quantized[:, ::2, ::2] 
zlib_subsampled = zlib.compress(subsampled.tobytes(), level=6)
print(f"Strategy 2 (UInt8 128x128x50 + Zlib): {len(zlib_subsampled)/1024:.2f} KB | Time: {time.time()-t0:.4f}s")

# Strategy 3: WebP 3D Strip (Lossy)
# Stack into a 256x12800 grayscale image and let WebP compress it
import io
from PIL import Image
t0 = time.time()
d, h, w = quantized.shape
strip = quantized.reshape((d*h, w))
img = Image.fromarray(strip, mode='L')
buf = io.BytesIO()
img.save(buf, format='WEBP', quality=80)
print(f"Strategy 3 (WebP Lossy Strip): {len(buf.getvalue())/1024:.2f} KB | Time: {time.time()-t0:.4f}s")

