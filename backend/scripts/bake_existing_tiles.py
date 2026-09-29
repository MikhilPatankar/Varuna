import sys
import os
from pathlib import Path
import duckdb

# Add backend directory to Python path
backend_dir = Path(__file__).parent.parent.resolve()
sys.path.insert(0, str(backend_dir))

from polaris.config import DUCKDB_PATH
from polaris.pipeline.tile_baker import bake_tiles_for_dataset
from polaris.logger import logger

def main():
    logger.info("Starting retroactive tile baking for all existing Zarr datasets...")
    
    try:
        # Connect to DuckDB to find all gridded datasets
        con = duckdb.connect(str(DUCKDB_PATH))
        records = con.execute("SELECT dataset_name, temporal_type, time_key FROM dataset_catalog WHERE category = 'gridded'").fetchall()
        con.close()
        
        if not records:
            logger.info("No gridded datasets found in catalog.")
            return

        logger.info(f"Found {len(records)} datasets to process.")
        
        for idx, (variable, tier, time_key) in enumerate(records, 1):
            logger.info(f"--- Processing {idx}/{len(records)}: {variable} | {tier} | {time_key} ---")
            try:
                # Bake tiles from zoom 0 to 3
                bake_tiles_for_dataset(variable, tier, time_key, max_zoom=3)
                logger.info(f"Successfully baked tiles for {variable} ({time_key})")
            except Exception as e:
                logger.error(f"Failed to bake tiles for {variable} ({time_key}): {e}")
                
        logger.info("Finished retroactive tile baking!")
        
    except Exception as e:
        logger.error(f"Error querying dataset catalog: {e}")

if __name__ == "__main__":
    main()
