import requests, json

# Test OceanOPS with requests - look at what the map viewer actually calls
# The correct filter for active platforms uses their specific API filter format

# Test several filter formats:
base = "https://www.ocean-ops.org/api/1/data/platform"

tests = [
    {'limit': 3},  # no filter
    {'limit': 3, 'exp': "ptfTypeId=26"},  # Float type
]

for params in tests:
    r = requests.get(base, params=params)
    print(f"Params: {params} => Status: {r.status_code}")
    if r.status_code == 200:
        d = r.json()
        print(f"  total={d.get('total')}")
        print(f"  sample keys: {list(d['data'][0].keys()) if d.get('data') else 'empty'}")
    else:
        print(f"  Error: {r.text[:200]}")

# Try fetching the actual JSON from the OceanOPS map 
print("\n\nFetch active platforms in last 30 days...")
import datetime
cutoff = (datetime.datetime.utcnow() - datetime.timedelta(days=30)).strftime('%Y-%m-%d')
url = f"https://www.ocean-ops.org/api/1/data/platform?limit=10"
r = requests.get(url)
d = r.json()
print("Keys in first record:", list(d['data'][0].keys()))
# Check if there's a ptfTypeId in the object
for k, v in d['data'][0].items():
    if v is not None:
        print(f"  {k}: {v}")
