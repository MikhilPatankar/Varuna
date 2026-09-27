"""
Debug script to check interp linear behavior.
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

lon_centers = np.linspace(lon_min + lon_step/2, lon_max - lon_step/2, 4)
lat_centers = np.linspace(lat_min + lat_step/2, lat_max - lat_step/2, 4)

ds_lon_min = float(ds.lon.min())
ds_lon_max_val = float(ds.lon.max())
lon_centers = np.clip(lon_centers, ds_lon_min, ds_lon_max_val)

try:
    data = ds['temperature'].sel(depth=0, method='nearest').interp(lat=lat_centers, lon=lon_centers, method='linear')
    print("SUCCESS!")
    print(data.values)
except Exception as e:
    print(f"FAILED: {e}")
