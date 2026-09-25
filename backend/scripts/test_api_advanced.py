import asyncio
import time
import httpx
import numpy as np

BASE_URL = "http://127.0.0.1:8000/api/v1"

async def test_concurrency(client, url, params, num_requests=50):
    """Test if the API handles simultaneous concurrent requests without crashing or race conditions."""
    print(f"\n--- Testing Concurrency ({num_requests} simultaneous requests) ---")
    
    t0 = time.time()
    # Launch all requests at the exact same time
    tasks = [client.get(url, params=params) for _ in range(num_requests)]
    responses = await asyncio.gather(*tasks, return_exceptions=True)
    t1 = time.time()
    
    success = 0
    failed = 0
    
    for r in responses:
        if isinstance(r, Exception):
            failed += 1
        elif r.status_code == 200:
            success += 1
        else:
            failed += 1
            
    print(f"Time Taken: {(t1-t0):.2f} seconds")
    print(f"Successful: {success}/{num_requests}")
    print(f"Failed:     {failed}/{num_requests}")
    
    if failed > 0:
        print("WARNING: Race condition or bottleneck detected under load!")
    else:
        print("PASS: Zarr and FastAPI handled concurrency safely.")

async def test_vulnerabilities(client):
    """Test Path Traversal and Out-of-Bounds requests."""
    print("\n--- Testing Vulnerabilities & Edge Cases ---")
    
    # 1. Path Traversal
    print("Testing Path Traversal (e.g., ../../../etc/passwd)")
    bad_url = f"{BASE_URL}/data/../../../etc/passwd/daily/2026-08-22"
    res = await client.get(bad_url, params={"lat_min": 0, "lat_max": 1, "lon_min": 0, "lon_max": 1, "depth_min": 0, "depth_max": 1})
    print(f"Path Traversal Status: {res.status_code} (Should be 404 or 400)")
    
    # 2. Inverted Bounding Box
    print("Testing Inverted Bounding Box (lat_min > lat_max)")
    url = f"{BASE_URL}/data/salinity/daily/2026-08-22"
    res = await client.get(url, params={"lat_min": 20, "lat_max": 10, "lon_min": 70, "lon_max": 79})
    print(f"Inverted Box Status: {res.status_code}")
    
    # 3. Out of Bounds coordinates
    print("Testing Out of Bounds Coordinates (Lat 900)")
    res = await client.get(url, params={"lat_min": 800, "lat_max": 900, "lon_min": 0, "lon_max": 10})
    print(f"Out of Bounds Status: {res.status_code}")
    
async def test_researcher_data_integrity(client):
    """Test data validity from a researcher's POV."""
    print("\n--- Testing Data Integrity (Researcher POV) ---")
    
    url = f"{BASE_URL}/data/salinity/daily/2026-08-22"
    # Query a region that includes land (e.g. over India) to test NaNs
    params = {
        "lat_min": 10.0, "lat_max": 20.0,
        "lon_min": 70.0, "lon_max": 80.0,
        "depth_min": 0.0, "depth_max": 0.0
    }
    
    res = await client.get(url, params=params)
    if res.status_code == 200:
        shape_str = res.headers.get("X-Data-Shape", "")
        shape = tuple(int(x) for x in shape_str.split(","))
        
        # Convert binary back to numpy
        values = np.frombuffer(res.content, dtype=np.float32).reshape(shape)
        
        # Check for our Sentinel NaN value (-9999.0)
        nan_count = np.sum(values == -9999.0)
        valid_count = np.sum(values != -9999.0)
        
        print(f"Grid Shape: {shape}")
        print(f"Landmass (NaN) cells detected: {nan_count}")
        print(f"Ocean (Valid) cells detected: {valid_count}")
        
        if valid_count > 0:
            valid_data = values[values != -9999.0]
            print(f"Min Salinity: {np.min(valid_data):.2f} PSU")
            print(f"Max Salinity: {np.max(valid_data):.2f} PSU")
            
            # Physical bounds check
            if np.min(valid_data) < 0 or np.max(valid_data) > 50:
                print("WARNING: Unrealistic physical salinity values detected!")
            else:
                print("PASS: Salinity values are within realistic ocean boundaries (0-50 PSU).")
    else:
        print(f"Failed to fetch data for integrity test: {res.status_code}")

async def main():
    print("=== POLARIS ADVANCED API TESTING ===")
    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Run Data Integrity Test
        await test_researcher_data_integrity(client)
        
        # 2. Run Vulnerability Tests
        await test_vulnerabilities(client)
        
        # 3. Run Concurrency Stress Test
        url = f"{BASE_URL}/data/salinity/daily/2026-08-22/slice"
        params = {"lat_min": 10.0, "lat_max": 15.0, "lon_min": 70.0, "lon_max": 75.0, "depth": 0.0}
        await test_concurrency(client, url, params, num_requests=100)

if __name__ == "__main__":
    asyncio.run(main())
