"""
Build bathymetry PMTiles from Zarr store for Cesium.js terrain rendering.
Run ONCE after: python cli/fetch.py --source bathymetry

Output: data/static/bathymetry.pmtiles (~8 MB)
Served: GET /static/bathymetry.pmtiles
"""
import subprocess
import xarray as xr
import rioxarray  # noqa: F401 — registers rio accessor on xarray
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))
from polaris.config import ZARR_ROOT, DATA_DIR

STATIC_DIR = DATA_DIR / "static"
STATIC_DIR.mkdir(exist_ok=True)

# Step 1 — Load bathymetry from Zarr
print("Loading bathymetry from Zarr...")
ds = xr.open_zarr(str(ZARR_ROOT / "bathymetry" / "static" / "static.zarr"))
da = ds["bathymetry"]

# Step 2 — Export to GeoTIFF
tif_path = STATIC_DIR / "bathymetry_raw.tif"
da.rio.set_spatial_dims(x_dim="lon", y_dim="lat")
da.rio.write_crs("EPSG:4326", inplace=True)
da.rio.to_raster(str(tif_path), dtype="float32")
print(f"GeoTIFF written: {tif_path}")

# Step 3 — Encode as single-band grayscale scaled for Terrain-RGB
# Scale: -11000m (deep trench) to +8000m (Himalayas) → 0..255
rgb_tif_path = STATIC_DIR / "bathymetry_rgb.tif"
subprocess.run([
    "gdal_translate",
    "-of", "GTiff", "-ot", "Byte",
    "-scale", "-11000", "8000", "0", "255",
    str(tif_path), str(rgb_tif_path)
], check=True)
print(f"Scaled GeoTIFF written: {rgb_tif_path}")

# Step 4 — Tile to MBTiles (zoom levels 0–8 covers Indian Ocean at ~300m/px)
mbtiles_path = STATIC_DIR / "bathymetry.mbtiles"
subprocess.run([
    "rio", "mbtiles", str(rgb_tif_path),
    "-o", str(mbtiles_path),
    "--zoom-levels", "0..8",
    "--format", "PNG",
    "--resampling", "bilinear"
], check=True)
print(f"MBTiles written: {mbtiles_path}")

# Step 5 — Convert to PMTiles
pmtiles_path = STATIC_DIR / "bathymetry.pmtiles"
subprocess.run([
    "pmtiles", "convert",
    str(mbtiles_path), str(pmtiles_path)
], check=True)
print(f"PMTiles written: {pmtiles_path}")

# Cleanup intermediates
tif_path.unlink(missing_ok=True)
rgb_tif_path.unlink(missing_ok=True)
mbtiles_path.unlink(missing_ok=True)
print("Done. Output: data/static/bathymetry.pmtiles")
