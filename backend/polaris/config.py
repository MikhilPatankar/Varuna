import os
from pathlib import Path

# Base paths
BASE_DIR = Path(__file__).parent.parent.resolve()
DATA_DIR = BASE_DIR / "data"

# Storage paths
ZARR_ROOT = DATA_DIR / "zarr"
DUCKDB_PATH = DATA_DIR / "polaris.duckdb"
RAW_DATA_DIR = DATA_DIR / "raw"

# Ensure directories exist
ZARR_ROOT.mkdir(parents=True, exist_ok=True)
RAW_DATA_DIR.mkdir(parents=True, exist_ok=True)

# Chunking configuration for spatial grid
# ~5.3 degrees per chunk laterally, 10 depth levels
CHUNK_CONFIG = {
    'lon': 64,
    'lat': 64,
    'depth': 10,
}

# Global subset
GLOBAL_BOUNDS = {
    'lat_min': -90.0,
    'lat_max': 90.0,
    'lon_min': -180.0,
    'lon_max': 180.0,
}
