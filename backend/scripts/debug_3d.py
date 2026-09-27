import time
import numpy as np
import xarray as xr
from polaris.config import ZARR_ROOT
import os
import io
from PIL import Image

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

print("Extracting 3D volume (50 depths)...")
t0 = time.time()
data = ds['temperature'].sel(lat=lat_da, lon=lon_da, method='nearest')
values = data.values.astype(np.float32)

d, h, w = values.shape
print(f"Shape: {values.shape}")
values = values.reshape((d * h, w))

vmin, vmax = 0.0, 35.0
nan_mask = np.isnan(values)
values = np.nan_to_num(values, nan=vmin)
values = np.clip(values, vmin, vmax)

encoded = np.round((values - vmin) / (vmax - vmin) * 16777215.0).astype(np.int32)
R = (encoded >> 16) & 0xFF
G = (encoded >> 8) & 0xFF
B = encoded & 0xFF
A = np.where(nan_mask, 0, 255).astype(np.uint8)

rgba = np.stack([R, G, B, A], axis=-1).astype(np.uint8)
img = Image.fromarray(rgba, mode='RGBA')
buf = io.BytesIO()
img.save(buf, format='PNG', compress_level=1)

print(f"Total time for 1 3D chunk: {time.time() - t0:.4f}s")
print(f"Payload size: {len(buf.getvalue()) / 1024:.2f} KB")
