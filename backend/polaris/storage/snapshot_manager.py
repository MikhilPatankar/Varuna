import xarray as xr
import shutil
import duckdb
from pathlib import Path
from polaris.config import ZARR_ROOT, DUCKDB_PATH, CHUNK_CONFIG

class SnapshotManager:
    """Manages the 52-set rolling window."""

    TIER_LIMITS = {'yearly': 10, 'monthly': 12, 'daily': 30}

    def rotate(self, variable: str, tier: str, new_data: xr.Dataset, time_key: str):
        """Add new snapshot, remove oldest if over limit."""
        store_path = f"{ZARR_ROOT}/{variable}/{tier}/{time_key}.zarr"
        
        # Write new snapshot
        new_data.chunk(CHUNK_CONFIG).to_zarr(store_path, mode='w', consolidated=True)

        # List existing snapshots and trim
        target_dir = Path(ZARR_ROOT) / variable / tier
        existing = sorted(target_dir.glob("*.zarr"))
        limit = self.TIER_LIMITS.get(tier, 30)
        
        if len(existing) > limit:
            con = duckdb.connect(str(DUCKDB_PATH))
            for old in existing[:-limit]:
                # Remove from disk
                shutil.rmtree(old)
                # Remove from catalog
                con.execute("DELETE FROM dataset_catalog WHERE storage_path = ?", [str(old)])
            con.close()
