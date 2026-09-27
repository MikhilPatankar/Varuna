from fastapi import APIRouter, Query, Response
import math
import xarray as xr
import numpy as np
from polaris.config import ZARR_ROOT
from pathlib import Path
from polaris.logger import logger
import io
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend, must be set before importing pyplot
import matplotlib.pyplot as plt
import matplotlib.cm as cm
from matplotlib.colors import Normalize
from PIL import Image

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
            # Revert to lazy loading. .load() on 5GB zarr freezes the server.
            # We will use an LRU cache on the API endpoint instead to handle concurrent frontend requests.
            ds = xr.open_zarr(path, consolidated=True)
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
def get_volume_chunk(
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
    stride: int = Query(8, ge=1, le=64, description="Subsample every Nth point. stride=8 reduces 35MB global grid to ~0.55MB"),
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

    # ── Server-side Downsampling ───────────────────────────────────────
    # Subsample AFTER geographic selection so actual lat/lon bounds stay accurate.
    # Default stride=8: 2041x4320 global (35MB) → ~255x540 (0.55MB) in <1s
    if stride > 1:
        data = data.isel(lat=slice(None, None, stride), lon=slice(None, None, stride))

    values = data.values.astype(np.float32)
    values = np.where(np.isnan(values), -9999.0, values)

    # Use ACTUAL bounds from the real data coords — critical for correct Cesium draping
    actual_lat_min = float(data.lat.values.min())
    actual_lat_max = float(data.lat.values.max())
    actual_lon_min = float(data.lon.values.min())
    actual_lon_max = float(data.lon.values.max())

    shape_str = ",".join(str(s) for s in values.shape)

    return Response(
        content=values.tobytes(),
        media_type="application/octet-stream",
        headers={
            "X-Data-Shape": shape_str,
            "X-Data-Dtype": "float32",
            "X-Lat-Min": str(actual_lat_min),
            "X-Lat-Max": str(actual_lat_max),
            "X-Lon-Min": str(actual_lon_min),
            "X-Lon-Max": str(actual_lon_max),
            "X-Depth": str(float(data.depth.values)) if 'depth' in data.coords else "0",
            "X-Variable": variable,
            "X-Value-Min": str(float(np.nanmin(data.values))),
            "X-Value-Max": str(float(np.nanmax(data.values))),
            "X-NaN-Value": "-9999.0",
            "Access-Control-Expose-Headers": "*",
        },
    )
@router.get("/{variable}/{tier}/{time_key}/render")
async def render_depth_slice(
    variable: str, tier: str, time_key: str,
    lat_min: float = Query(-90), lat_max: float = Query(90),
    lon_min: float = Query(-180), lon_max: float = Query(180),
    depth: float = Query(0.0),
    colormap: str = Query('turbo', description="Matplotlib colormap name"),
    vmin: float = Query(None, description="Min value for colorscale (auto if omitted)"),
    vmax: float = Query(None, description="Max value for colorscale (auto if omitted)"),
    fmt: str = Query('webp', description="Output format: webp or png"),
):
    """
    Render a 2D depth slice as a compressed WebP/PNG image using a server-side colormap.
    Returns full native resolution at ~0.5-2MB instead of 35MB raw floats.
    Transparent pixels for land/NaN — drapes cleanly over the Cesium globe.
    """
    ds = get_cached_dataset(variable, tier, time_key)
    if ds is None:
        return Response(status_code=404, content="Data not found")

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

    values = data.values.astype(np.float64)
    nan_mask = np.isnan(values)  # True = land/missing

    # Auto scale if not provided
    actual_vmin = float(vmin) if vmin is not None else float(np.nanmin(values))
    actual_vmax = float(vmax) if vmax is not None else float(np.nanmax(values))

    # Apply colormap → RGBA uint8 array
    norm = Normalize(vmin=actual_vmin, vmax=actual_vmax, clip=True)
    cmap = matplotlib.colormaps.get_cmap(colormap)
    rgba = cmap(norm(values), bytes=True)  # shape: (H, W, 4), uint8

    # Set NaN/land pixels fully transparent
    rgba[nan_mask, 3] = 0

    # Flip vertically: NetCDF lat goes bottom-up, image coords go top-down
    rgba = rgba[::-1, :, :]

    # Encode to WebP or PNG via PIL
    img = Image.fromarray(rgba, mode='RGBA')
    buf = io.BytesIO()
    if fmt == 'webp':
        img.save(buf, format='WEBP', quality=85, method=4)
        media_type = 'image/webp'
    else:
        img.save(buf, format='PNG', optimize=True)
        media_type = 'image/png'
    buf.seek(0)

    actual_lat_min = float(data.lat.values.min())
    actual_lat_max = float(data.lat.values.max())
    actual_lon_min = float(data.lon.values.min())
    actual_lon_max = float(data.lon.values.max())

    return Response(
        content=buf.getvalue(),
        media_type=media_type,
        headers={
            "X-Lat-Min": str(actual_lat_min),
            "X-Lat-Max": str(actual_lat_max),
            "X-Lon-Min": str(actual_lon_min),
            "X-Lon-Max": str(actual_lon_max),
            "X-Value-Min": str(actual_vmin),
            "X-Value-Max": str(actual_vmax),
            "X-Variable": variable,
            "Access-Control-Expose-Headers": "*",
        },
    )


def xyz_to_bbox_geographic(x, y, z):
    # Cesium GeographicTilingScheme uses 2x1 root tiles at zoom 0.
    # cols = 2^(z+1), rows = 2^z
    cols = 2 ** (z + 1)
    rows = 2 ** z
    
    lon_deg_per_tile = 360.0 / cols
    lat_deg_per_tile = 180.0 / rows
    
    lon_min = -180.0 + x * lon_deg_per_tile
    lon_max = -180.0 + (x + 1) * lon_deg_per_tile
    
    # Y is top (0) to bottom (rows - 1)
    lat_max = 90.0 - y * lat_deg_per_tile
    lat_min = 90.0 - (y + 1) * lat_deg_per_tile
    
    return lat_min, lat_max, lon_min, lon_max

from cachetools import LRUCache
_TILE_RESPONSE_CACHE = LRUCache(maxsize=128)

@router.get("/{variable}/{tier}/{time_key}/tile/{z}/{x}/{y}")
def get_float_tile(
    variable: str, tier: str, time_key: str, z: int, x: int, y: int,
    depth: float = Query(None, description="If not specified, all depths are returned vertically stacked"),
    vmin: float = Query(None, description="Global min value for encoding"),
    vmax: float = Query(None, description="Global max value for encoding")
):
    """Return a float-packed PNG for the given XYZ tile, optionally stacked with all depths."""
    
    # 1. Check API Response Cache
    cache_key = f"{variable}_{tier}_{time_key}_{z}_{x}_{y}_{depth}_{vmin}_{vmax}"
    if cache_key in _TILE_RESPONSE_CACHE:
        cached_content, cached_headers, media_type = _TILE_RESPONSE_CACHE[cache_key]
        return Response(content=cached_content, media_type=media_type, headers=cached_headers)
        
    ds = get_cached_dataset(variable, tier, time_key)
    if ds is None:
        return Response(status_code=404, content="Data not found")

    is_3d = ('depth' in ds.dims) and (depth is None)
    if is_3d and z == 0 and x == 0 and y == 0:
        lat_min, lat_max, lon_min, lon_max = -90.0, 90.0, -180.0, 180.0
    else:
        lat_min, lat_max, lon_min, lon_max = xyz_to_bbox_geographic(x, y, z)

    if 'time' in ds.dims:
        ds = ds.isel(time=-1)

    if 'depth' in ds.dims and depth is not None:
        ds = ds.sel(depth=depth, method='nearest')

    # Generate exact 256x256 pixel centers for this tile
    lon_step = (lon_max - lon_min) / 256.0
    lat_step = (lat_max - lat_min) / 256.0
    lon_centers = np.linspace(lon_min + lon_step/2, lon_max - lon_step/2, 256)

    ds_lon_min = float(np.nanmin(ds.lon.values))
    ds_lon_max_val = float(np.nanmax(ds.lon.values))
    lon_centers = np.clip(lon_centers, ds_lon_min, ds_lon_max_val)
    lat_centers = np.linspace(lat_min + lat_step/2, lat_max - lat_step/2, 256)

    lat_indices = np.abs(ds.lat.values[:, None] - lat_centers).argmin(axis=0)
    lon_indices = np.abs(ds.lon.values[:, None] - lon_centers).argmin(axis=0)

    data = ds[variable].isel(lat=lat_indices, lon=lon_indices)
    values = data.values.astype(np.float32)

    is_3d = ('depth' in ds.dims) and (depth is None)
    if is_3d:
        depth_count = values.shape[0]
    
    if vmin is None:
        vmin = float(np.nanmin(values)) if not np.isnan(values).all() else 0.0
    if vmax is None:
        vmax = float(np.nanmax(values)) if not np.isnan(values).all() else 1.0
    if vmin == vmax:
        vmax = vmin + 1.0

    nan_mask = np.isnan(values)
    values = np.nan_to_num(values, nan=vmin)
    values = np.clip(values, vmin, vmax)

    if is_3d:
        # --- 3D VOLUMETRIC GZIP CHUNK ---
        quantized = np.clip(
            (values - vmin) / (vmax - vmin) * 254.0 + 1.0, 1.0, 255.0
        ).astype(np.uint8)
        quantized[nan_mask] = 0
        
        import gzip
        compressed = gzip.compress(quantized.tobytes(), compresslevel=6)

        headers = {
            "X-Value-Min":   str(vmin),
            "X-Value-Max":   str(vmax),
            "X-Depth-Count": str(depth_count),
            "X-Depth-Levels": ",".join(str(float(d)) for d in ds.depth.values),
        }
        
        # 2. Store in API Response Cache
        _TILE_RESPONSE_CACHE[cache_key] = (compressed, headers, "application/octet-stream")
        return Response(content=compressed, media_type="application/octet-stream", headers=headers)
        return Response(content=compressed, media_type="application/octet-stream", headers=headers)
        
    else:
        # --- 2D FLAT TILE PNG ---
        # Encode to RGB (Mapbox Terrain-RGB method)
        encoded = np.round((values - vmin) / (vmax - vmin) * 16777215.0).astype(np.int32)
        R = (encoded >> 16) & 0xFF
        G = (encoded >> 8) & 0xFF
        B = encoded & 0xFF
        A = np.where(nan_mask, 0, 255).astype(np.uint8)
    
        rgba = np.stack([R, G, B, A], axis=-1).astype(np.uint8)
    
        img = Image.fromarray(rgba, mode='RGBA')
        buf = io.BytesIO()
        img.save(buf, format='PNG', compress_level=1)
        buf.seek(0)
    
        return Response(
            content=buf.getvalue(),
        media_type='image/png',
        headers={
            "X-Value-Min": str(vmin),
            "X-Value-Max": str(vmax),
            "X-Variable": variable,
            "Cache-Control": "max-age=3600",
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
