import duckdb

con = duckdb.connect('e:/PROJECT/POLARIS/backend/data/polaris.duckdb')

print("=== Instruments ===")
print(con.execute("SELECT instrument_type, COUNT(*) as cnt FROM instruments GROUP BY instrument_type ORDER BY cnt DESC").fetchdf())

print("\n=== Profiles ===")
# Wait, instrument_type is only in instruments table, let's join
query = """
SELECT i.instrument_type, COUNT(p.profile_id) as cnt
FROM profiles p
JOIN instruments i ON p.instrument_id = i.instrument_id
GROUP BY i.instrument_type
ORDER BY cnt DESC
"""
print(con.execute(query).fetchdf())
con.close()
