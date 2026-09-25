import duckdb
from polaris.api.routes.data import get_cached_dataset
import numpy as np

# Mocking the preload
print("=== Starting Zarr check ===")
con = duckdb.connect('e:/PROJECT/POLARIS/backend/data/polaris.duckdb')

obs_date = "2026-09-21"
lat = 19.278
lon = -118.923

print(f"Testing for {obs_date} at lat={lat}, lon={lon}")

ds_temp = get_cached_dataset('temperature', 'daily', obs_date)
if ds_temp is not None:
    print("Found temperature dataset.")
    print("Coords:", ds_temp.coords)
    try:
        val = ds_temp['temperature'].sel(lat=lat, lon=lon, depth=0.0, method='nearest').values
        print("Raw val:", val, type(val))
        print("Rounded val:", round(float(val), 2))
    except Exception as e:
        print("Error selecting:", e)
else:
    print("Dataset not found for time_key:", obs_date)
