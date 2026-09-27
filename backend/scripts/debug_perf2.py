import time
import numpy as np
import xarray as xr
from polaris.config import ZARR_ROOT
import os

path = os.path.join(ZARR_ROOT, "temperature", "daily", "2026-09-21.zarr")
ds = xr.open_zarr(path, consolidated=False).isel(time=-1).load()

lon_min, lon_max = -180.0, -90.0
lat_min, lat_max = 0.0, 90.0
lon_step = (lon_max - lon_min) / 256.0
lat_step = (lat_max - lat_min) / 256.0

lon_centers = np.linspace(lon_min + lon_step/2, lon_max - lon_step/2, 256)
lat_centers = np.linspace(lat_min + lat_step/2, lat_max - lat_step/2, 256)

lon_centers = np.clip(lon_centers, float(np.nanmin(ds.lon.values)), float(np.nanmax(ds.lon.values)))

print("Testing cropped linear...")
t0 = time.time()
for _ in range(10):
    # Crop first
    pad = 0.5
    subset = ds['temperature'].sel(depth=0, method='nearest').sel(
        lat=slice(lat_min - pad, lat_max + pad),
        lon=slice(lon_min - pad, lon_max + pad)
    )
    data_linear = subset.interp(lat=lat_centers, lon=lon_centers, method='linear')
    _ = data_linear.values
print(f"Cropped Linear 10x: {time.time() - t0:.4f}s")
