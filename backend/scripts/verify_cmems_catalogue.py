import copernicusmarine

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
            # The python API returns a Catalogue containing the product
            catalogue = copernicusmarine.describe(product_id=prod_id)
            if not catalogue.products:
                print(f"  [ERROR] Product {prod_id} not found.")
                continue
                
            product = catalogue.products[0]
            print(f"  [FOUND] Title: {product.title}")
            
            all_vars = {}
            # Check variables in datasets
            for ds in product.datasets:
                for var_name, var_obj in ds.variables.items():
                    if var_name not in all_vars:
                        all_vars[var_name] = var_obj.standard_name or var_obj.long_name
            
            # Verify our target variables
            for var_key, desc in TARGET_VARIABLES.items():
                if var_key in all_vars:
                    print(f"    [OK] Variable '{var_key}' exists: {all_vars[var_key]} -> Matches required {desc}")
                else:
                    if (prod_id == "GLOBAL_MULTIYEAR_PHY_001_030" and var_key in ["thetao", "so", "zos"]) or \
                       (prod_id == "GLOBAL_ANALYSISFORECAST_BGC_001_028" and var_key in ["chl", "o2", "no3", "po4", "si"]):
                        print(f"    [MISSING] Variable '{var_key}' NOT FOUND in this product!")
        
        except Exception as e:
            print(f"  [ERROR] Could not fetch product details: {e}")

if __name__ == "__main__":
    verify()
