import sys
import os
from pathlib import Path
from datetime import datetime
import argparse
import logging
import xarray as xr
import numpy as np
import copernicusmarine

# Set up paths to integrate with Polaris
backend_dir = Path(__file__).parent.parent.resolve()
sys.path.insert(0, str(backend_dir))
from polaris.config import RAW_DATA_DIR, ZARR_ROOT
from polaris.pipeline.ingestion import IngestionPipeline

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("AnomalyGenerator")

def generate_anomaly(years: int = 5):
    target_dates = []
    now = datetime.utcnow()
    # CMEMS usually has a 1-day delay for anfc data, so use yesterday as "today"
    # Actually, let's just use the latest available date. 
    # For safety, let's pick exactly 2 days ago as the baseline "current" date to ensure data exists.
    from datetime import timedelta
    current_date = now - timedelta(days=2)
    
    target_dates.append(current_date)
    for i in range(1, years + 1):
        try:
            # Handle leap years safely
            target_dates.append(current_date.replace(year=current_date.year - i))
        except ValueError:
            target_dates.append(current_date.replace(year=current_date.year - i, day=28))
            
    logger.info(f"Target dates for anomaly calculation: {[d.strftime('%Y-%m-%d') for d in target_dates]}")
    
    dataset_id = "cmems_mod_glo_phy-thetao_anfc_0.083deg_P1D-m"
    var_name = "thetao"
    
    downloaded_files = []
    
    for dt in target_dates:
        dt_str = dt.strftime('%Y-%m-%d')
        out_file = f"anomaly_tmp_{dt_str}.nc"
        out_path = RAW_DATA_DIR / out_file
        
        if out_path.exists():
            logger.info(f"Using cached file {out_path}")
            downloaded_files.append(out_path)
            continue
            
        logger.info(f"Downloading data for {dt_str}...")
        try:
            copernicusmarine.subset(
                dataset_id=dataset_id,
                variables=[var_name],
                minimum_longitude=-180,
                maximum_longitude=179.99,
                minimum_latitude=-90,
                maximum_latitude=90,
                start_datetime=f"{dt_str} 00:00:00",
                end_datetime=f"{dt_str} 23:59:59",
                minimum_depth=0,
                maximum_depth=0.5,
                output_filename=out_file,
                output_directory=str(RAW_DATA_DIR),
                force_download=True,
            )
            downloaded_files.append(out_path)
        except Exception as e:
            logger.error(f"Failed to download for {dt_str}: {e}")
            
    if not downloaded_files:
        logger.error("No files downloaded, aborting anomaly calculation.")
        return False
        
    logger.info("Computing anomaly...")
    datasets = []
    for f in downloaded_files:
        try:
            ds = xr.open_dataset(f)
            datasets.append(ds)
        except Exception as e:
            logger.error(f"Failed to open {f}: {e}")
            
    if len(datasets) < 2:
        logger.error("Not enough data to compute an anomaly.")
        return False
        
    # The first dataset is the current year
    ds_current = datasets[0].copy()
    
    # The remaining datasets are historical
    ds_historical = xr.concat(datasets[1:], dim='time')
    
    # Calculate historical mean (average of all past years for this day)
    # Using raw numpy to bypass xarray/numbagg NumPy 2.x crash
    hist_data = ds_historical[var_name].values
    current_data = ds_current[var_name].values
    
    hist_mean = np.nanmean(hist_data, axis=0)
    anomaly_data = current_data - hist_mean
    
    ds_anomaly = ds_current
    ds_anomaly[var_name].values = anomaly_data
    
    # Rename variable so the frontend knows it's the anomaly
    anomaly_var_name = f'anomaly_temperature_{years}'
    ds_anomaly = ds_anomaly.rename({var_name: anomaly_var_name})
    
    time_key = target_dates[0].strftime('%Y-%m-%d')
    out_zarr = ZARR_ROOT / anomaly_var_name / "daily" / f"{time_key}.zarr"
    
    out_zarr.parent.mkdir(parents=True, exist_ok=True)
    
    logger.info(f"Saving anomaly to {out_zarr}...")
    # Add dummy depth/time dims if they were dropped, or just save as 2D
    if 'depth' in ds_anomaly.dims:
        ds_anomaly = ds_anomaly.squeeze('depth')
        
    ds_anomaly.to_zarr(str(out_zarr), mode='w', consolidated=True)
    logger.info("Anomaly saved successfully!")
    
    # Cleanup tmp files
    for f in downloaded_files:
        try:
            os.remove(f)
        except:
            pass
            
    return True

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--years", type=int, default=5, help="Number of historical years to compare against")
    args = parser.parse_args()
    generate_anomaly(years=args.years)
