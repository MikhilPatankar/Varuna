import os
import sys
import numpy as np
import xarray as xr
import rioxarray
from pathlib import Path

def convert_zarr_to_tiff(zarr_path, tiff_path):
    print(f"Loading Zarr: {zarr_path}")
    if not os.path.exists(zarr_path):
        print("Error: Zarr dataset not found.")
        sys.exit(1)
        
    ds = xr.open_zarr(zarr_path)
    
    # We are explicitly using the 'deptho' variable downloaded via cmems_mod_glo_phy_my_0.083deg_static
    var_name = "deptho"
    print(f"Extracting variable: {var_name}")
    data_array = ds[var_name]
    
    # Ensure spatial dimensions are strictly 'y' and 'x' for rioxarray
    if 'latitude' in data_array.dims and 'longitude' in data_array.dims:
        data_array = data_array.rename({'latitude': 'y', 'longitude': 'x'})
    elif 'lat' in data_array.dims and 'lon' in data_array.dims:
        data_array = data_array.rename({'lat': 'y', 'lon': 'x'})
        
    # Ensure the Y-axis (latitude) is sorted in descending order (North to South)
    # GeoTIFFs strictly expect origin at Top-Left (North-West)
    if data_array.y[0] < data_array.y[-1]:
        print("Flipping Y-axis to North-to-South...")
        data_array = data_array.isel(y=slice(None, None, -1))
        
    # Set the CRS to WGS84 (EPSG:4326)
    data_array = data_array.rio.write_crs("EPSG:4326")
    
    # Write to GeoTIFF
    print(f"Writing GeoTIFF to: {tiff_path}")
    data_array.rio.to_raster(tiff_path)
    print("Success! GeoTIFF created.")

if __name__ == "__main__":
    base_dir = Path(__file__).resolve().parent.parent
    zarr_file = base_dir / "data" / "zarr" / "deptho" / "static" / "static.zarr"
    tiff_file = base_dir / "data" / "global_bathymetry.tif"
    
    convert_zarr_to_tiff(str(zarr_file), str(tiff_file))
