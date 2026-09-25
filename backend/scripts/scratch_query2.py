import duckdb
con=duckdb.connect('e:/PROJECT/POLARIS/backend/data/polaris.duckdb')
print(con.execute("SELECT instrument_type, COUNT(*) FROM instruments GROUP BY instrument_type").fetchdf())
