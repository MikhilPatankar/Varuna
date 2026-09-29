import xarray as xr
from polaris.config import ZARR_ROOT, CHUNK_CONFIG

class ZarrStore:
    def __init__(self, root_path=ZARR_ROOT):
        self.root_path = root_path

    def _get_store_path(self, variable: str, tier: str, time_key: str) -> str:
        return str(self.root_path / variable / tier / f"{time_key}.zarr")

    def write(self, ds: xr.Dataset, variable: str, tier: str, time_key: str):
        """Write dataset to chunked Zarr store."""
        store_path = self._get_store_path(variable, tier, time_key)
        
        # Ensure the dataset only contains the required variable
        if len(list(ds.data_vars)) > 1:
            var_ds = ds[[variable]]
        else:
            var_ds = ds

        # Only chunk dimensions that actually exist in this variable
        chunk_cfg = {
            dim: size
            for dim, size in CHUNK_CONFIG.items()
            if dim in var_ds.dims
        }
        var_ds = var_ds.chunk(chunk_cfg)
        # Write to Zarr
        var_ds.to_zarr(store_path, mode='w', consolidated=True)
        
        # Trigger offline tile baking automatically for the newly ingested dataset
        from polaris.pipeline.tile_baker import bake_tiles_for_dataset
        import logging
        logger = logging.getLogger("polaris")
        logger.info(f"Automatically triggering tile baking for {variable}...")
        bake_tiles_for_dataset(variable, tier, time_key, max_zoom=3)
        
        return store_path

    def read(self, variable: str, tier: str, time_key: str) -> xr.Dataset:
        """Read lazily from Zarr store."""
        store_path = self._get_store_path(variable, tier, time_key)
        return xr.open_zarr(store_path, consolidated=True)
