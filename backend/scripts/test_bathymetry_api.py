import requests
import time
import json
from rich.console import Console
from rich.table import Table

console = Console()
API_BASE = "http://localhost:8000/api/v1/data/bathymetry/static/static"

def test_endpoint(name, params, is_slice=False):
    url = API_BASE
    if is_slice:
        url += "/slice"
    
    start_time = time.time()
    try:
        response = requests.get(url, params=params)
        duration_ms = (time.time() - start_time) * 1000
        
        if response.status_code == 200:
            size_bytes = len(response.content)
            size_mb = size_bytes / (1024 * 1024)
            shape = response.headers.get("X-Data-Shape", "Unknown")
            val_min = response.headers.get("X-Value-Min", "Unknown")
            val_max = response.headers.get("X-Value-Max", "Unknown")
            
            return {
                "Test Case": name,
                "Status": "OK",
                "Time (ms)": f"{duration_ms:.1f}",
                "Size (MB)": f"{size_mb:.2f} MB",
                "Shape": shape,
                "Min Depth": val_min,
                "Max Depth": val_max
            }
        else:
            return {
                "Test Case": name,
                "Status": f"ERR {response.status_code}",
                "Time (ms)": f"{duration_ms:.1f}",
                "Size (MB)": "-",
                "Shape": "-",
                "Min Depth": "-",
                "Max Depth": "-"
            }
    except Exception as e:
        return {
            "Test Case": name,
            "Status": "FAILED",
            "Time (ms)": "-",
            "Size (MB)": "-",
            "Shape": "-",
            "Min Depth": "-",
            "Max Depth": "-"
        }

def run_tests():
    console.print("\n[bold blue]Running Bathymetry API Performance Tests...[/bold blue]\n")
    
    tests = [
        {
            "name": "Whole Globe (Full Resolution)",
            "params": {"lat_min": -90, "lat_max": 90, "lon_min": -180, "lon_max": 180},
            "is_slice": False
        },
        {
            "name": "Indian Ocean Region",
            "params": {"lat_min": -10, "lat_max": 30, "lon_min": 40, "lon_max": 100},
            "is_slice": False
        },
        {
            "name": "Arabian Sea (Local Patch)",
            "params": {"lat_min": 10, "lat_max": 20, "lon_min": 60, "lon_max": 75},
            "is_slice": False
        },
        {
            "name": "Arabian Sea (Slice API)",
            "params": {"lat_min": 10, "lat_max": 20, "lon_min": 60, "lon_max": 75, "depth": 0},
            "is_slice": True
        }
    ]
    
    results = []
    # Warm up request
    requests.get(API_BASE, params={"lat_min": 0, "lat_max": 1, "lon_min": 0, "lon_max": 1})
    
    for t in tests:
        res = test_endpoint(t["name"], t["params"], t["is_slice"])
        results.append(res)
        
    table = Table(title="Bathymetry API Performance")
    table.add_column("Test Case", style="cyan")
    table.add_column("Status", justify="center")
    table.add_column("Time (ms)", justify="right", style="green")
    table.add_column("Size (MB)", justify="right", style="yellow")
    table.add_column("Grid Shape", justify="right")
    table.add_column("Min Depth", justify="right")
    
    for r in results:
        table.add_row(
            r["Test Case"], r["Status"], r["Time (ms)"], 
            r["Size (MB)"], r["Shape"], r["Min Depth"]
        )
        
    console.print(table)
    console.print("\n[bold green]Testing Complete![/bold green]")

if __name__ == "__main__":
    run_tests()
