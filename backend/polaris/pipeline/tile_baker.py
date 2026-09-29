import numpy as np
import xarray as xr
import gzip
import json
from pathlib import Path
from polaris.config import DATA_DIR, ZARR_ROOT
from polaris.logger import logger

def xyz_to_bbox(x, y, z):
    cols = 2 ** (z + 1)
    rows = 2 ** z
    lon_min = -180.0 + x * 360.0 / cols
    lon_max = -180.0 + (x + 1) * 360.0 / cols
    lat_max = 90.0 - y * 180.0 / rows
    lat_min = 90.0 - (y + 1) * 180.0 / rows
    return lat_min, lat_max, lon_min, lon_max

def bake_tiles_for_dataset(variable: str, tier: str, time_key: str, max_zoom: int = 3):
    """
    Reads a Zarr dataset and pre-bakes 256x256 tiles for zooms 0 to max_zoom.
    Uses simple quantization and gzip compression (no delta encoding).
    """
    zarr_path = Path(ZARR_ROOT) / variable / tier / f"{time_key}.zarr"
    tiles_root = Path(DATA_DIR) / "tiles" / variable / tier / time_key
    
    if not zarr_path.exists():
        logger.error(f"Zarr path does not exist: {zarr_path}")
        return

    logger.info(f"Loading {zarr_path} into RAM for tile baking...")
    try:
        ds = xr.open_zarr(str(zarr_path), consolidated=True).load()
    except Exception as e:
        logger.error(f"Failed to load dataset: {e}")
        return
        
    if 'time' in ds.dims:
        ds = ds.isel(time=-1)

    raw = ds[variable].values
    vmin = float(np.nanmin(raw))
    vmax = float(np.nanmax(raw))
    depth_count = len(ds.depth.values) if 'depth' in ds.dims else 0
    depth_levels = ",".join([str(float(d)) for d in ds.depth.values]) if depth_count > 0 else ""

    logger.info(f"Baking tiles for {variable} (vmin={vmin:.2f}, vmax={vmax:.2f})...")

    # Generate tiles for each zoom level
    for z in range(max_zoom + 1):
        cols = 2 ** (z + 1)
        rows = 2 ** z
        z_dir = tiles_root / str(z)
        z_dir.mkdir(parents=True, exist_ok=True)
        
        logger.info(f"  Zoom {z}: {cols}x{rows} grid")
        
        for x in range(cols):
            for y in range(rows):
                if z == 0 and x == 0 and y == 0:
                    # Cesium VoxelProvider expects the root tile to cover the ENTIRE globe.
                    # A standard Web Mercator tile 0/0/0 only covers the Western hemisphere.
                    lat_min, lat_max, lon_min, lon_max = -90.0, 90.0, -180.0, 180.0
                else:
                    lat_min, lat_max, lon_min, lon_max = xyz_to_bbox(x, y, z)
                
                lon_step = (lon_max - lon_min) / 256.0
                lat_step = (lat_max - lat_min) / 256.0
                lc = np.linspace(lon_min + lon_step/2, lon_max - lon_step/2, 256)
                ltc = np.linspace(lat_min + lat_step/2, lat_max - lat_step/2, 256)
                
                # Clip to prevent out-of-bounds nearest neighbor lookup
                lc = np.clip(lc, float(ds.lon.values.min()), float(ds.lon.values.max()))
                
                li = np.abs(ds.lat.values[:, None] - ltc).argmin(axis=0)
                loi = np.abs(ds.lon.values[:, None] - lc).argmin(axis=0)
                
                if depth_count > 0:
                    tile = raw[np.ix_(np.arange(raw.shape[0]), li, loi)]
                    shape = [depth_count, 256, 256]
                else:
                    tile = raw[np.ix_(li, loi)]
                    shape = [256, 256]
                    
                nan_mask = np.isnan(tile)
                
                clean = np.nan_to_num(tile, nan=vmin)
                clean = np.clip(clean, vmin, vmax)
                
                # Basic quantization to uint8
                quantized = np.clip((clean - vmin) / (vmax - vmin) * 254.0 + 1.0, 1.0, 255.0).astype(np.uint8)
                quantized[nan_mask] = 0
                
                # Gzip raw data
                payload = gzip.compress(quantized.tobytes(), compresslevel=6)
                
                # Header
                header_dict = {
                    "vmin": vmin,
                    "vmax": vmax,
                    "depth_count": depth_count,
                    "depth_levels": depth_levels,
                    "encoding": "gzip",
                    "shape": shape
                }
                header_bytes = (json.dumps(header_dict) + "\n").encode('utf-8')
                
                out_file = z_dir / f"{x}_{y}.bin"
                with open(out_file, 'wb') as f:
                    f.write(header_bytes)
                    f.write(payload)

    logger.info(f"Finished baking all tiles for {variable}.")
