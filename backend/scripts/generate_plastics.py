import os
import zarr
import numpy as np
import xarray as xr

def generate_plastic_grid():
    # Define grid
    lats = np.linspace(-90, 90, 720)
    lons = np.linspace(-180, 180, 1440)
    
    lon_grid, lat_grid = np.meshgrid(lons, lats)
    
    # Base concentration
    plastic_density = np.zeros_like(lon_grid)
    
    # 5 Major Gyres (Garbage Patches)
    # North Pacific, South Pacific, North Atlantic, South Atlantic, Indian Ocean
    gyres = [
        {"lat": 35, "lon": -140, "intensity": 10.0, "sigma_lat": 15, "sigma_lon": 30}, # GPGP (largest)
        {"lat": -25, "lon": -120, "intensity": 4.0, "sigma_lat": 10, "sigma_lon": 25}, # SPG
        {"lat": 30, "lon": -40, "intensity": 6.0, "sigma_lat": 12, "sigma_lon": 20},   # NAG
        {"lat": -25, "lon": -10, "intensity": 3.0, "sigma_lat": 10, "sigma_lon": 15},  # SAG
        {"lat": -25, "lon": 70, "intensity": 3.5, "sigma_lat": 10, "sigma_lon": 20},   # IOG
    ]
    
    for g in gyres:
        # Calculate gaussian distribution around the gyre
        dist = np.exp(-(((lat_grid - g["lat"]) ** 2) / (2 * g["sigma_lat"] ** 2) + 
                        ((lon_grid - g["lon"]) ** 2) / (2 * g["sigma_lon"] ** 2)))
        plastic_density += dist * g["intensity"]
        
    # Add some background coastal noise / general accumulation
    noise = np.random.lognormal(mean=-2.0, sigma=1.0, size=lon_grid.shape)
    plastic_density += noise * 0.1
    
    # Clip to avoid massive spikes from lognormal
    plastic_density = np.clip(plastic_density, 0, 12.0)
    
    # Create xarray Dataset
    ds = xr.Dataset(
        data_vars=dict(
            plastics=(["lat", "lon"], plastic_density, {"units": "kg/km^2"})
        ),
        coords=dict(
            lat=(["lat"], lats),
            lon=(["lon"], lons),
        ),
        attrs=dict(description="Synthetic Global Ocean Plastic Density")
    )
    
    # Save to Zarr
    out_dir = os.path.join(os.path.dirname(__file__), "..", "data", "zarr", "plastics", "daily")
    os.makedirs(out_dir, exist_ok=True)
    
    store_path = os.path.join(out_dir, "2026-10-02.zarr")
    
    # Write to Zarr
    ds.to_zarr(store_path, mode="w")
    print(f"Saved plastic density to {store_path}")

if __name__ == "__main__":
    generate_plastic_grid()
