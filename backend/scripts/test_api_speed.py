import time
import requests
import numpy as np

BASE_URL = "http://127.0.0.1:8000/api/v1"

def test_api():
    print("=== POLARIS COMPREHENSIVE API TEST ===")
    
    # 1. Fetch Catalog
    t0 = time.time()
    resp = requests.get(f"{BASE_URL}/datasets")
    t1 = time.time()
    
    if resp.status_code != 200:
        print(f"Failed to fetch catalog: {resp.status_code}")
        return
        
    datasets = resp.json()
    print(f"\n1. Catalog Fetch: {len(datasets)} datasets found in {(t1-t0)*1000:.1f} ms")
    
    # Let's test the oldest date we have (2026-08-22) for Salinity
    # Find the specific dataset in the catalog
    target_ds = next((ds for ds in datasets if ds["dataset_name"] == "salinity" and ds["time_key"] == "2026-08-22"), None)
    
    if not target_ds:
        print("\nCould not find salinity for 2026-08-22 in catalog. Testing first available instead.")
        target_ds = datasets[0]
        
    var = target_ds["dataset_name"]
    tier = target_ds["temporal_type"]
    time_key = target_ds["time_key"]
    
    print(f"\n==========================================")
    print(f" TESTING DATASET: {var} ({time_key})")
    print(f"==========================================")
    
    # --- TEST 1: Full 3D Volume ---
    print(f"\n--- TEST 1: 3D Volume (1000x1000km, 0-500m depth) ---")
    vol_url = f"{BASE_URL}/data/{var}/{tier}/{time_key}"
    vol_params = {
        "lat_min": 10.0, "lat_max": 19.0,
        "lon_min": 70.0, "lon_max": 79.0,
        "depth_min": 0.0, "depth_max": 500.0
    }
    t0 = time.time()
    res = requests.get(vol_url, params=vol_params)
    t1 = time.time()
    print(f"Latency:        {(t1-t0)*1000:.1f} ms")
    print(f"Data Shape:     {res.headers.get('X-Data-Shape')} (Depth x Lat x Lon)")
    print(f"Payload Size:   {len(res.content) / (1024*1024):.2f} MB")
    
    # --- TEST 2: 2D Depth Slice ---
    print(f"\n--- TEST 2: 2D Depth Slice (1000x1000km exactly at 100m depth) ---")
    slice_url = f"{BASE_URL}/data/{var}/{tier}/{time_key}/slice"
    slice_params = {
        "lat_min": 10.0, "lat_max": 19.0,
        "lon_min": 70.0, "lon_max": 79.0,
        "depth": 100.0
    }
    t0 = time.time()
    res = requests.get(slice_url, params=slice_params)
    t1 = time.time()
    print(f"Latency:        {(t1-t0)*1000:.1f} ms")
    print(f"Data Shape:     {res.headers.get('X-Data-Shape')} (Lat x Lon)")
    print(f"Payload Size:   {len(res.content) / 1024:.2f} KB")
    
    # --- TEST 3: 1D Depth Column ---
    print(f"\n--- TEST 3: 1D Depth Column (All 50 depths for a single Lat/Lon point) ---")
    col_url = f"{BASE_URL}/data/{var}/{tier}/{time_key}/column"
    col_params = {
        "lat": 15.0,
        "lon": 75.0
    }
    t0 = time.time()
    res = requests.get(col_url, params=col_params)
    t1 = time.time()
    print(f"Latency:        {(t1-t0)*1000:.1f} ms")
    print(f"Data Shape:     {res.headers.get('X-Data-Shape')} (Depths)")
    print(f"Payload Size:   {len(res.content)} Bytes")

if __name__ == "__main__":
    test_api()
