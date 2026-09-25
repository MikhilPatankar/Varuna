import asyncio
import httpx
import time
import json
import sys

BASE_URL = "http://127.0.0.1:8000/api/v1/hazards"

class APITester:
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=30.0)
        self.passed = 0
        self.failed = 0

    async def run_test(self, name, endpoint, params=None, expected_status=200):
        start_time = time.time()
        url = f"{BASE_URL}{endpoint}"
        
        try:
            response = await self.client.get(url, params=params)
            latency = (time.time() - start_time) * 1000
            
            if response.status_code == expected_status:
                self.passed += 1
                msg = f"[PASSED] in {latency:.1f}ms."
                
                # If it's a successful 200, let's print some shape info
                if response.status_code == 200:
                    data = response.json()
                    if isinstance(data, list):
                        msg += f" (Returned {len(data)} items)"
                        
                print(f"{msg}")
            else:
                self.failed += 1
                print(f"[FAILED] in {latency:.1f}ms. Expected {expected_status}, got {response.status_code}")
                try:
                    print(f"         Error: {response.json()}")
                except:
                    print(f"         Error: {response.text}")
                    
        except Exception as e:
            self.failed += 1
            print(f"[ERROR] Request failed entirely: {repr(e)}")

async def run_hazard_tests():
    tester = APITester()
    
    print("\n=====================================================")
    print("  POLARIS HAZARD API CONDITIONS TEST SUITE")
    print("=====================================================")

    # 1. TEMPORAL QUERIES (date)
    print("\n--- 1. TEMPORAL QUERIES (date) ---")
    
    print("\n[TEST] Query Cyclones for a specific day (Hurricane Katrina - Aug 29, 2005)")
    print("       GET /cyclones?date=2005-08-29")
    await tester.run_test("Historical Day (Katrina)", "/cyclones", {"date": "2005-08-29"}, expected_status=200)

    print("\n[TEST] Query Cyclones for an entire year (2005)")
    print("       GET /cyclones?year=2005")
    await tester.run_test("Historical Year (2005)", "/cyclones", {"year": 2005}, expected_status=200)

    # 2. SPATIAL QUERIES (bbox)
    print("\n--- 2. SPATIAL QUERIES (bbox) ---")
    
    print("\n[TEST] Bounding Box query (Gulf of Mexico)")
    print("       GET /cyclones?bbox=-98.0,18.0,-80.0,30.0")
    await tester.run_test("Spatial BBox", "/cyclones", {"bbox": "-98.0,18.0,-80.0,30.0"}, expected_status=200)

    # 3. EDGE CASES & MALFORMED REQUESTS
    print("\n--- 3. EDGE CASES & MALFORMED REQUESTS ---")
    
    print("\n[TEST] Invalid Date Format (String instead of YYYY-MM-DD)")
    print("       GET /cyclones?date=not-a-date")
    # DuckDB TRY_CAST safely converts invalid dates to NULL, which results in 0 matches and an empty [] (HTTP 200) instead of a 500 Server Crash.
    await tester.run_test("Invalid Date String", "/cyclones", {"date": "not-a-date"}, expected_status=200)

    print("\n[TEST] Invalid BBox Format (Too few coordinates)")
    print("       GET /cyclones?bbox=-98.0,18.0")
    # Python will fail map(float, split(',')) which raises ValueError.
    await tester.run_test("Invalid BBox", "/cyclones", {"bbox": "-98.0,18.0"}, expected_status=400)

    # 4. OIL SPILLS
    print("\n--- 4. OIL SPILLS ---")
    
    print("\n[TEST] Query all recent Oil Spills")
    print("       GET /oil_spill")
    await tester.run_test("All Oil Spills", "/oil_spill", expected_status=200)

    print("\n[TEST] Query Oil Spills by BBox (Gulf of Mexico)")
    print("       GET /oil_spill?bbox=-98.0,18.0,-80.0,30.0")
    await tester.run_test("Oil Spills BBox", "/oil_spill", {"bbox": "-98.0,18.0,-80.0,30.0"}, expected_status=200)

    print("\n=====================================================")
    print(f" TEST RUN COMPLETE.  PASS: {tester.passed} | FAIL: {tester.failed}")
    print("=====================================================\n")
    
    await tester.client.aclose()
    
    if tester.failed > 0:
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(run_hazard_tests())
