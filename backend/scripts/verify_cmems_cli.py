import subprocess

PRODUCTS = {
    "Physics (Temp, Salinity, SSH)": "GLOBAL_MULTIYEAR_PHY_001_030",
    "BGC (Chl, O2, NO3, PO4, Si)": "GLOBAL_ANALYSISFORECAST_BGC_001_028"
}

TARGET_VARIABLES = {
    "thetao": "Temperature (3D)",
    "so": "Salinity (3D)",
    "zos": "Sea Surface Height (2D)",
    "chl": "Chlorophyll (3D)",
    "o2": "Dissolved Oxygen (3D)",
    "no3": "Nitrate (3D)",
    "po4": "Phosphate (3D)",
    "si": "Silicate (3D)",
}

def verify():
    for label, prod_id in PRODUCTS.items():
        print(f"\n{'='*60}")
        print(f"Checking Product: {prod_id} [{label}]")
        print(f"{'='*60}")
        
        try:
            # We run the CLI tool which outputs JSON, and we parse it
            result = subprocess.run(["copernicusmarine", "describe", "--product-id", prod_id], capture_output=True, text=True)
            import json
            data = json.loads(result.stdout)
            
            # Print the time coverage of the first dataset
            if data.get("datasets"):
                services = data["datasets"][0].get("services", [])
                for service in services:
                    variables = service.get("variables", [])
                    if variables:
                        # Grab the first variable to check its time coordinates if available
                        coords = variables[0].get("coordinates", [])
                        for coord in coords:
                            if coord.get("coordinate_id") == "time":
                                min_val = coord.get("minimum_value")
                                max_val = coord.get("maximum_value")
                                print(f"    [TIME] Coverage: {min_val} to {max_val}")
                                break
                        break

            output = result.stdout
            
            # Verify our target variables
            for var_key, desc in TARGET_VARIABLES.items():
                if f'"short_name": "{var_key}"' in output:
                    print(f"    [OK] Variable '{var_key}' exists in product -> Matches required {desc}")
                else:
                    if (prod_id == "GLOBAL_MULTIYEAR_PHY_001_030" and var_key in ["thetao", "so", "zos"]) or \
                       (prod_id == "GLOBAL_ANALYSISFORECAST_BGC_001_028" and var_key in ["chl", "o2", "no3", "po4", "si"]):
                        print(f"    [MISSING] Variable '{var_key}' NOT FOUND in this product!")
        
        except Exception as e:
            print(f"  [ERROR] Could not fetch product details: {e}")

if __name__ == "__main__":
    verify()
