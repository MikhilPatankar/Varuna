from fastapi import APIRouter, Query, Response
import xarray as xr
import numpy as np
from polaris.config import ZARR_ROOT
from pathlib import Path
from polaris.logger import logger

router = APIRouter(prefix="/api/v1/data", tags=["Gridded Data"])

# Dictionary to hold the opened Xarray datasets globally in memory
_DATASET_CACHE = {}

def preload_datasets(records: list):
    """
    Called by main.py on server startup.
    Pre-opens all datasets to avoid cold-start file I/O latency.
    """
    for row in records:
        dataset_name, temporal_type, time_key = row[0], row[1], row[2]
        
        path = Path(ZARR_ROOT) / dataset_name / temporal_type / f"{time_key}.zarr"
        if not path.exists():
            continue
            
        try:
            # We open with chunks=None to eagerly load metadata into memory but defer data reads to dask
            ds = xr.open_zarr(path, chunks=None)
            cache_key = f"{dataset_name}_{temporal_type}_{time_key}"
            _DATASET_CACHE[cache_key] = ds
        except Exception as e:
            logger.warning(f"Failed to cache dataset {cache_key}: {e}")

def get_cached_dataset(variable: str, tier: str, time_key: str):
    """Retrieve from RAM cache or load it if not exists."""
    key = f"{variable}_{tier}_{time_key}"
    if key not in _DATASET_CACHE:
        zarr_path = Path(ZARR_ROOT) / variable / tier / f"{time_key}.zarr"
        if not zarr_path.exists():
            return None
        # OPTIMIZATION: Call .load() to compute the dask arrays into NumPy RAM!
        # This completely eliminates disk I/O latency for subsequent API hits.
        _DATASET_CACHE[key] = xr.open_zarr(str(zarr_path), consolidated=True).load()
    return _DATASET_CACHE[key]

@router.get("/{variable}/{tier}/{time_key}")
async def get_volume_chunk(
    variable: str,
    tier: str,               
    time_key: str,           
    lat_min: float = Query(...),
    lat_max: float = Query(...),
    lon_min: float = Query(...),
    lon_max: float = Query(...),
    depth_min: float = Query(0.0),
    depth_max: float = Query(5000.0),
):
    """
    Return raw Float32Array binary data for a 3D volume chunk.
    """
    ds = get_cached_dataset(variable, tier, time_key)
    if ds is None:
        return Response(status_code=404, content="Data not found")
    
    # If a multi-timestep file is queried without a specific time slice, return the most recent timestep
    if 'time' in ds.dims:
        ds = ds.isel(time=-1)

    if 'depth' in ds.dims:
        data = ds[variable].sel(
            lat=slice(lat_min, lat_max),
            lon=slice(lon_min, lon_max),
            depth=slice(depth_min, depth_max),
        )
    else:
        # e.g., SSH which is 2D
        data = ds[variable].sel(
            lat=slice(lat_min, lat_max),
            lon=slice(lon_min, lon_max),
        )

    if data.size == 0:
        return Response(status_code=400, content="No data found in the requested bounding box (out of bounds or empty slice).")

    values = data.values.astype(np.float32)
    nan_sentinel = -9999.0
    values = np.where(np.isnan(values), nan_sentinel, values)

    lats = data.lat.values if 'lat' in data.coords else np.array([0])
    lons = data.lon.values if 'lon' in data.coords else np.array([0])
    depths = data.depth.values if 'depth' in data.coords else np.array([0])

    shape_str = ",".join(str(s) for s in values.shape)

    return Response(
        content=values.tobytes(),
        media_type="application/octet-stream",
        headers={
            "X-Data-Shape":    shape_str,
            "X-Data-Dtype":    "float32",
            "X-Lat-Min":       str(float(lats.min())),
            "X-Lat-Max":       str(float(lats.max())),
            "X-Lon-Min":       str(float(lons.min())),
            "X-Lon-Max":       str(float(lons.max())),
            "X-Depth-Levels":  ",".join(str(float(d)) for d in depths),
            "X-Variable":      variable,
            "X-Units":         ds[variable].attrs.get("units", "unknown"),
            "X-Time-Key":      time_key,
            "X-Value-Min":     str(float(np.nanmin(data.values))),
            "X-Value-Max":     str(float(np.nanmax(data.values))),
            "X-NaN-Value":     str(nan_sentinel),
            "Access-Control-Expose-Headers": (
                "X-Data-Shape, X-Data-Dtype, X-Lat-Min, X-Lat-Max, "
                "X-Lon-Min, X-Lon-Max, X-Depth-Levels, X-Variable, "
                "X-Units, X-Time-Key, X-Value-Min, X-Value-Max, X-NaN-Value"
            ),
        },
    )

@router.get("/{variable}/{tier}/{time_key}/slice")
async def get_depth_slice(
    variable: str, tier: str, time_key: str,
    lat_min: float = Query(...), lat_max: float = Query(...),
    lon_min: float = Query(...), lon_max: float = Query(...),
    depth: float = Query(0.0),
):
    """Return a 2D slice at a specific depth."""
    ds = get_cached_dataset(variable, tier, time_key)
    if ds is None:
        return Response(status_code=404, content="Data not found")
    
    # If a multi-timestep file is queried without a specific time slice, return the most recent timestep
    if 'time' in ds.dims:
        ds = ds.isel(time=-1)

    if 'depth' in ds.dims:
        data = ds[variable].sel(
            lat=slice(lat_min, lat_max),
            lon=slice(lon_min, lon_max)
        ).sel(depth=depth, method='nearest')
    else:
        data = ds[variable].sel(
            lat=slice(lat_min, lat_max),
            lon=slice(lon_min, lon_max),
        )

    if data.size == 0:
        return Response(status_code=400, content="No data found in the requested bounding box.")

    values = data.values.astype(np.float32)
    values = np.where(np.isnan(values), -9999.0, values)
    
    shape_str = ",".join(str(s) for s in values.shape)

    return Response(
        content=values.tobytes(),
        media_type="application/octet-stream",
        headers={
            "X-Data-Shape": shape_str,
            "X-Data-Dtype": "float32",
            "X-Lat-Min": str(float(data.lat.values.min())),
            "X-Lat-Max": str(float(data.lat.values.max())),
            "X-Lon-Min": str(float(data.lon.values.min())),
            "X-Lon-Max": str(float(data.lon.values.max())),
            "X-Depth": str(float(data.depth.values)) if 'depth' in data.coords else "0",
            "X-Variable": variable,
            "X-Value-Min": str(float(np.nanmin(data.values))),
            "X-Value-Max": str(float(np.nanmax(data.values))),
            "X-NaN-Value": "-9999.0",
            "Access-Control-Expose-Headers": "*",
        },
    )

@router.get("/{variable}/{tier}/{time_key}/column")
async def get_depth_column(
    variable: str, tier: str, time_key: str,
    lat: float = Query(...),
    lon: float = Query(...),
):
    """Return values at all depths for a single lat/lon point."""
    ds = get_cached_dataset(variable, tier, time_key)
    if ds is None:
        return Response(status_code=404, content="Data not found")

    data = ds[variable].sel(lat=lat, lon=lon, method='nearest')
    
    if 'time' in data.dims:
        data = data.isel(time=-1)
        
    if data.size == 0:
        return Response(status_code=400, content="No data found at requested coordinates.")
        
    values = data.values.astype(np.float32)
    values = np.where(np.isnan(values), -9999.0, values)
    
    shape_str = ",".join(str(s) for s in values.shape)

    return Response(
        content=values.tobytes(),
        media_type="application/octet-stream",
        headers={
            "X-Data-Shape": shape_str,
            "X-Data-Dtype": "float32",
            "X-Lat": str(float(data.lat.values)),
            "X-Lon": str(float(data.lon.values)),
            "X-Depth-Levels": ",".join(str(float(d)) for d in data.depth.values) if 'depth' in data.coords else "0",
            "X-Variable": variable,
            "Access-Control-Expose-Headers": "*",
        },
    )

@router.get("/{variable}/{tier}/{time_key}/timeseries")
async def get_timeseries(
    variable: str, tier: str, time_key: str,
    lat: float = Query(...),
    lon: float = Query(...),
    depth: float = Query(0.0),
):
    """Return values over all time steps for a single lat/lon/depth point."""
    ds = get_cached_dataset(variable, tier, time_key)
    if ds is None:
        return Response(status_code=404, content="Data not found")

    if 'time' not in ds.dims:
        return Response(status_code=400, content="Dataset does not have a time dimension")

    if 'depth' in ds.dims:
        data = ds[variable].sel(lat=lat, lon=lon, depth=depth, method='nearest')
    else:
        data = ds[variable].sel(lat=lat, lon=lon, method='nearest')
        
    if data.size == 0:
        return Response(status_code=400, content="No data found at requested coordinates.")
        
    values = data.values.astype(np.float32)
    values = np.where(np.isnan(values), -9999.0, values)
    
    # Get the time strings
    times = [str(t.values) for t in data.time]
    
    shape_str = ",".join(str(s) for s in values.shape)

    return Response(
        content=values.tobytes(),
        media_type="application/octet-stream",
        headers={
            "X-Data-Shape": shape_str,
            "X-Data-Dtype": "float32",
            "X-Lat": str(float(data.lat.values)),
            "X-Lon": str(float(data.lon.values)),
            "X-Depth": str(float(data.depth.values)) if 'depth' in data.coords else "0",
            "X-Variable": variable,
            "X-Timesteps": ",".join(times),
            "Access-Control-Expose-Headers": "*",
        },
    )
