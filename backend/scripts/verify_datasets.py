import xarray as xr
from pathlib import Path
import sys
import os

# Add the backend directory to the path so we can import polaris modules
backend_dir = Path(__file__).resolve().parent.parent
sys.path.append(str(backend_dir))

from polaris.config import ZARR_ROOT

REQUIRED_VARIABLES = {
    # 2D variables
    "ssh": {"name": "Sea Surface Height", "expected_3d": False},
    # 3D variables
    "temperature": {"name": "Temperature", "expected_3d": True},
    "salinity": {"name": "Salinity", "expected_3d": True},
    "chlorophyll": {"name": "Chlorophyll", "expected_3d": True},
    "oxygen": {"name": "Dissolved Oxygen", "expected_3d": True},
    "nitrate": {"name": "Nitrate", "expected_3d": True},
    "phosphate": {"name": "Phosphate", "expected_3d": True},
    "silicate": {"name": "Silicate", "expected_3d": True},
}

def verify_datasets():
    print(f"Checking ZARR_ROOT: {ZARR_ROOT}")
    print("-" * 60)
    
    if not ZARR_ROOT.exists():
        print(f"ERROR: ZARR_ROOT directory does not exist: {ZARR_ROOT}")
        return

    all_found = True

    for var_key, var_info in REQUIRED_VARIABLES.items():
        var_name = var_info["name"]
        expected_3d = var_info["expected_3d"]
        dim_type = "3D (depth)" if expected_3d else "2D (surface only)"
        
        print(f"Checking: {var_key} ({var_name}) - Expected: {dim_type}")
        
        var_dir = ZARR_ROOT / var_key
        
        if not var_dir.exists():
            print(f"  [MISSING] Directory {var_dir} not found.")
            all_found = False
            print("-" * 60)
            continue
            
        zarr_stores = list(var_dir.rglob("*.zarr"))
        
        if not zarr_stores:
            print(f"  [MISSING] No .zarr stores found inside {var_dir}.")
            all_found = False
            print("-" * 60)
            continue
            
        store_path = zarr_stores[0]
        try:
            ds = xr.open_zarr(store_path, consolidated=True)
            print(f"  [FOUND] {store_path.relative_to(ZARR_ROOT)}")
            
            dims = list(ds.dims)
            has_depth = 'depth' in dims
            
            print(f"     Dimensions: {dims}")
            
            if expected_3d and not has_depth:
                print(f"     [WARNING] Expected 3D (depth dimension), but 'depth' not found.")
            elif not expected_3d and has_depth:
                print(f"     [WARNING] Expected 2D, but found 'depth' dimension.")
            else:
                print(f"     [OK] Structure matches expected ({dim_type}).")
                
            data_vars = list(ds.data_vars)
            print(f"     Data variables: {data_vars}")
            
        except Exception as e:
            print(f"  [ERROR] Could not open {store_path}. Reason: {e}")
            all_found = False
            
        print("-" * 60)
        
    print("\nSummary:")
    if all_found:
        print("[SUCCESS] All required datasets are present and verified.")
    else:
        print("[FAILED] Some required datasets are missing or have errors.")

if __name__ == "__main__":
    verify_datasets()
