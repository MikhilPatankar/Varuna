import duckdb
from polaris.config import DUCKDB_PATH

def get_db():
    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute("LOAD spatial;")
    try:
        yield con
    finally:
        con.close()
