import duckdb
import sys
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).parent.parent.resolve()
sys.path.insert(0, str(backend_dir))

from polaris.config import DUCKDB_PATH

def init_db():
    print(f"Initializing DuckDB at {DUCKDB_PATH}...")
    
    # Connect to DuckDB
    con = duckdb.connect(str(DUCKDB_PATH))
    
    # Install and load spatial extension
    print("Installing and loading spatial extension...")
    con.execute("INSTALL spatial;")
    con.execute("LOAD spatial;")
    
    # Execute schema
    schema_path = backend_dir / "polaris" / "storage" / "schema.sql"
    print(f"Executing schema from {schema_path}...")
    with open(schema_path, "r") as f:
        schema_sql = f.read()
    
    con.execute(schema_sql)
    
    print("Database initialization complete.")
    con.close()

if __name__ == "__main__":
    init_db()
