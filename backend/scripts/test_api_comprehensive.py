import asyncio
import time
import httpx
import numpy as np
import sys

BASE_URL = "http://127.0.0.1:8000/api/v1"

class APITester:
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=10.0)
        self.results = {"PASS": 0, "FAIL": 0}
        
    async def run_test(self, name, endpoint, params, expected_status=200, check_fn=None):
        url = f"{BASE_URL}{endpoint}"
        print(f"\n[TEST] {name}")
        print(f"       GET {endpoint}")
        print(f"       Params: {params}")
        
        t0 = time.time()
        try:
            res = await self.client.get(url, params=params)
            latency = (time.time() - t0) * 1000
            
            status_pass = res.status_code == expected_status
            
            if not status_pass:
                print(f"       [FAILED] Expected HTTP {expected_status}, got {res.status_code}")
                if res.status_code == 500:
                    print("          (Note: If you haven't restarted Uvicorn since the empty-slice fix, you will get 500s here!)")
                self.results["FAIL"] += 1
                return
                
            if check_fn and status_pass:
                check_pass, msg = check_fn(res)
                if not check_pass:
                    print(f"       [FAILED DATA CHECK] {msg}")
                    self.results["FAIL"] += 1
                    return
                print(f"       [PASSED] in {latency:.1f}ms. {msg}")
            else:
                print(f"       [PASSED] in {latency:.1f}ms. (HTTP {res.status_code})")
                
            self.results["PASS"] += 1
            
        except Exception as e:
            print(f"       [ERROR] Request failed entirely: {e}")
            self.results["FAIL"] += 1

    async def close(self):
        await self.client.aclose()


# --- Custom Validation Functions ---

def validate_volume(res):
    shape_str = res.headers.get("X-Data-Shape", "")
    if not shape_str:
        return False, "Missing X-Data-Shape header."
    shape = tuple(int(x) for x in shape_str.split(","))
    if len(shape) != 3:
        return False, f"Expected 3D shape, got {shape}"
    return True, f"Valid 3D Volume Shape: {shape}"

def validate_empty_response(res):
    return True, "Correctly rejected bad request."

def validate_422(res):
    return True, "Correctly caught FastAPI validation error."

def validate_nan(res):
    # Check if a point completely on land returns NaN sentinel
    val = np.frombuffer(res.content, dtype=np.float32)
    if val.size > 0 and val[0] == -9999.0:
        return True, "Correctly returned NaN sentinel (-9999.0) for Land."
    return False, f"Expected NaN sentinel, got {val[0] if val.size > 0 else 'empty'}"

async def run_all():
    print("=====================================================")
    print("  POLARIS COMPREHENSIVE API CONDITIONS TEST SUITE")
    print("=====================================================")
    
    tester = APITester()
    var_path = "/data/salinity/daily/2026-08-22"
    
    # ---------------------------------------------------------
    # 1. STANDARD VALID REQUESTS
    # ---------------------------------------------------------
    print("\n--- 1. STANDARD GEOGRAPHIC REQUESTS ---")
    await tester.run_test("Standard 3D Volume", var_path,
        {"lat_min": 10, "lat_max": 20, "lon_min": 70, "lon_max": 80, "depth_min": 0, "depth_max": 100},
        expected_status=200, check_fn=validate_volume)
        
    await tester.run_test("Exact Map Grid Match (1 pixel)", var_path,
        {"lat_min": 15.0, "lat_max": 15.083, "lon_min": 75.0, "lon_max": 75.083},
        expected_status=200)

    # ---------------------------------------------------------
    # 2. DEPTH INTERPOLATION & BOUNDARIES
    # ---------------------------------------------------------
    print("\n--- 2. DEPTH INTERPOLATION & BOUNDARIES ---")
    await tester.run_test("Exact Surface Depth (0.494m)", f"{var_path}/slice",
        {"lat_min": 10, "lat_max": 15, "lon_min": 70, "lon_max": 75, "depth": 0.494},
        expected_status=200)
        
    await tester.run_test("In-between Depth (Snapping test - 10.5m)", f"{var_path}/slice",
        {"lat_min": 10, "lat_max": 15, "lon_min": 70, "lon_max": 75, "depth": 10.5},
        expected_status=200)
        
    await tester.run_test("Extreme Abyss Depth (10,000m - Out of Range)", f"{var_path}/slice",
        {"lat_min": 10, "lat_max": 15, "lon_min": 70, "lon_max": 75, "depth": 10000},
        expected_status=200) # xarray nearest neighbor will snap to the deepest available point (e.g. 5000m)

    # ---------------------------------------------------------
    # 2.5 OCEAN CURRENTS (uo & vo)
    # ---------------------------------------------------------
    print("\n--- 2.5 OCEAN CURRENTS ---")
    # Note: Our ingestion pipeline renames 'uo' to 'u_current' and 'vo' to 'v_current' automatically.
    # The time_key is the current date when fetched, we will test for 2026-09-21.
    await tester.run_test("Eastward Velocity (u_current) Surface Slice", "/data/u_current/daily/2026-09-21/slice",
        {"lat_min": 10, "lat_max": 15, "lon_min": 70, "lon_max": 75, "depth": 0.494},
        expected_status=200)
        
    await tester.run_test("Northward Velocity (v_current) Deep Column", "/data/v_current/daily/2026-09-21/column",
        {"lat": 15.0, "lon": 75.0},
        expected_status=200)

    # ---------------------------------------------------------
    # 3. EDGE CASES & MALFORMED REQUESTS (GEOGRAPHIC)
    # ---------------------------------------------------------
    print("\n--- 3. EDGE CASES & MALFORMED REQUESTS ---")
    await tester.run_test("Inverted Bounding Box (LatMin > LatMax)", var_path,
        {"lat_min": 20, "lat_max": 10, "lon_min": 70, "lon_max": 80},
        expected_status=400, check_fn=validate_empty_response)
        
    await tester.run_test("Out of Bounds Coordinates (Lat 900)", var_path,
        {"lat_min": 900, "lat_max": 910, "lon_min": 70, "lon_max": 80},
        expected_status=400, check_fn=validate_empty_response)

    # ---------------------------------------------------------
    # 4. FASTAPI VALIDATION ERRORS
    # ---------------------------------------------------------
    print("\n--- 4. TYPE & VALIDATION ERRORS ---")
    await tester.run_test("Missing Required Parameters (No Lon)", var_path,
        {"lat_min": 10, "lat_max": 20},
        expected_status=422, check_fn=validate_422)
        
    await tester.run_test("Invalid Data Type (String in Float field)", var_path,
        {"lat_min": "abc", "lat_max": 20, "lon_min": 70, "lon_max": 80},
        expected_status=422, check_fn=validate_422)
        
    # ---------------------------------------------------------
    # 5. DATA NOT FOUND / INVALID ASSETS
    # ---------------------------------------------------------
    print("\n--- 5. RESOURCE AVAILABILITY ---")
    await tester.run_test("Non-existent Variable", "/data/alien_dna/daily/2026-08-22",
        {"lat_min": 10, "lat_max": 20, "lon_min": 70, "lon_max": 80},
        expected_status=404)
        
    await tester.run_test("Future Time Key", "/data/salinity/daily/2099-01-01",
        {"lat_min": 10, "lat_max": 20, "lon_min": 70, "lon_max": 80},
        expected_status=404)
        
    # ---------------------------------------------------------
    # 6. PHYSICAL GEOGRAPHY TESTS
    # ---------------------------------------------------------
    print("\n--- 6. PHYSICAL GEOGRAPHY (NaN handling) ---")
    await tester.run_test("Query perfectly on Land (e.g. Center of India)", f"{var_path}/column",
        {"lat": 21.0, "lon": 79.0},
        expected_status=200, check_fn=validate_nan)

    # Finish
    await tester.close()
    
    print("\n=====================================================")
    print(f" TEST RUN COMPLETE.  PASS: {tester.results['PASS']} | FAIL: {tester.results['FAIL']}")
    print("=====================================================")

if __name__ == "__main__":
    # Windows asyncio fix for python 3.8+
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(run_all())
