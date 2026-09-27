"""
Debug script to check Xarray dimension ordering and descending coordinates behavior.
"""
import sys
sys.path.insert(0, '.')

import numpy as np
import xarray as xr
from polaris.config import ZARR_ROOT
import os

path = os.path.join(ZARR_ROOT, "temperature", "daily", "2026-09-21.zarr")
ds = xr.open_zarr(path, consolidated=False).isel(time=-1)

# Pick a tile: Y=0, X=0, Z=1 (North-Western hemisphere: lat=0..90, lon=-180..-90)
lon_min, lon_max = -180.0, -90.0
lat_min, lat_max = 0.0, 90.0

lon_step = (lon_max - lon_min) / 4.0
lat_step = (lat_max - lat_min) / 4.0

# 4 pixels to make it easy to print
lon_centers = np.linspace(lon_min + lon_step/2, lon_max - lon_step/2, 4)
lat_centers = np.linspace(lat_max - lat_step/2, lat_min + lat_step/2, 4)

print("lat_centers (expect descending 90 -> 0):")
print(lat_centers)
print("lon_centers (expect ascending -180 -> -90):")
print(lon_centers)

ds_lon_max = float(ds.lon.max())
if ds_lon_max > 180:
    lon_wrapped = (lon_centers % 360 + 360) % 360
else:
    lon_wrapped = ((lon_centers + 180) % 360 + 360) % 360 - 180

lon_da = xr.DataArray(lon_wrapped, dims='x')
lat_da = xr.DataArray(lat_centers, dims='y')

data = ds['temperature'].sel(depth=0, method='nearest').sel(lat=lat_da, lon=lon_da, method='nearest')

print("\nResulting dimensions of data:")
print(data.dims)

print("\nData latitudes (should match lat_centers order):")
print(data.lat.values)

print("\nData longitudes (should match lon_wrapped order):")
print(data.lon.values)

print("\nShape of values array:", data.values.shape)
