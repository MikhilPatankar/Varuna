import asyncio
import httpx
import random
import sys

BASE_URL = "http://127.0.0.1:8000/api/v1/data/salinity/daily/2026-08-22"

LATS = [None, -90.0, -45.0, 0.0, 15.0, 90.0, 120.0, "invalid_lat"]
LONS = [None, -180.0, -90.0, 0.0, 75.0, 180.0, 200.0, "invalid_lon"]
DEPTHS = [None, -50.0, 0.0, 100.0, 10000.0, "abyss"]

def generate_combinations(num_requests=200):
    """Generate random permutations of query parameters."""
    requests = []
    
    for _ in range(num_requests):
        # Randomly choose an endpoint
        endpoint = random.choice(["", "/slice", "/column"])
        
        params = {}
        
        # Randomly populate parameters based on what the endpoint might expect
        # We deliberately mix and match to see if the API crashes
        if random.random() > 0.1: params["lat_min"] = random.choice(LATS)
        if random.random() > 0.1: params["lat_max"] = random.choice(LATS)
        if random.random() > 0.1: params["lon_min"] = random.choice(LONS)
        if random.random() > 0.1: params["lon_max"] = random.choice(LONS)
        
        if endpoint == "/column":
            if random.random() > 0.1: params["lat"] = random.choice(LATS)
            if random.random() > 0.1: params["lon"] = random.choice(LONS)
            
        if endpoint in ["", "/slice"]:
            if random.random() > 0.1: params["depth"] = random.choice(DEPTHS)
            if random.random() > 0.1: params["depth_min"] = random.choice(DEPTHS)
            if random.random() > 0.1: params["depth_max"] = random.choice(DEPTHS)
            
        # Clean up None values to simulate missing parameters
        params = {k: v for k, v in params.items() if v is not None}
        
        requests.append((endpoint, params))
        
    return requests

async def run_fuzzer():
    print("=====================================================")
    print("  POLARIS API FUZZER: PERMUTATION & COMBINATION TEST ")
    print("=====================================================")
    print("Goal: Hit the API with hundreds of chaotic parameter")
    print("combinations to guarantee ZERO 500 Internal Server Errors.")
    print("-----------------------------------------------------")
    
    combos = generate_combinations(300) # 300 random permutations
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        tasks = []
        for endpoint, params in combos:
            url = f"{BASE_URL}{endpoint}"
            tasks.append(client.get(url, params=params))
            
        print(f"Firing {len(combos)} permutations concurrently...")
        responses = await asyncio.gather(*tasks, return_exceptions=True)
        
    counts = {200: 0, 400: 0, 422: 0, 404: 0, 500: 0, "ERROR": 0}
    
    for r in responses:
        if isinstance(r, Exception):
            counts["ERROR"] += 1
        else:
            if r.status_code in counts:
                counts[r.status_code] += 1
            else:
                counts[r.status_code] = counts.get(r.status_code, 0) + 1
                
    print("\n--- RESULTS ---")
    print(f"[OK] 200 OK (Valid Data Returned):           {counts.get(200, 0)}")
    print(f"[OK] 400 Bad Request (Gracefully Caught):    {counts.get(400, 0)}")
    print(f"[OK] 422 Unprocessable (Typing/Validation):  {counts.get(422, 0)}")
    print(f"[OK] 404 Not Found:                          {counts.get(404, 0)}")
    print(f"[FAIL] 500 Internal Server Error (CRASH):      {counts.get(500, 0)}")
    print(f"[FAIL] Network Errors:                         {counts.get('ERROR', 0)}")
    
    if counts.get(500, 0) == 0 and counts.get("ERROR", 0) == 0:
        print("\n[SUCCESS] The API is fully bulletproof against bad queries.")
    else:
        print("\n[WARNING] The API crashed on some permutations. Check logs.")

if __name__ == "__main__":
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(run_fuzzer())
