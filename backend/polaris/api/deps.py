import duckdb
from polaris.config import DUCKDB_PATH

def get_db():
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    try:
        con.execute("LOAD spatial;")
    except Exception:
        try:
            con.execute("INSTALL spatial;")
            con.execute("LOAD spatial;")
        except Exception:
            pass
    try:
        yield con
    finally:
        con.close()
