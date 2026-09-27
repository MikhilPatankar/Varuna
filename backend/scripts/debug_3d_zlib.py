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

t0 = time.time()
data = ds['temperature'].sel(lat=lat_da, lon=lon_da, method='nearest')
values = data.values.astype(np.float16) # use float16 to halve the size!
values = np.nan_to_num(values, nan=-999.0) # Mask NaNs

binary_data = values.tobytes()
compressed = zlib.compress(binary_data, level=1)

print(f"Extraction and Zlib time: {time.time() - t0:.4f}s")
print(f"Float16 Payload size: {len(compressed) / 1024:.2f} KB")
