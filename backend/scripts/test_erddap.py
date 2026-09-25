import requests, pandas as pd
from io import StringIO
from datetime import datetime, timedelta

def check_maxtime(url):
    try:
        r = requests.get(url, timeout=10)
        df = pd.read_csv(StringIO(r.text))
        attrs = df[df['Row Type'] == 'attribute']
        max_time = attrs[attrs['Attribute Name'] == 'time_coverage_end']['Value'].values
        if len(max_time) > 0:
            return max_time[0]
        return "Unknown"
    except Exception as e:
        return f"Error: {e}"

print("AOML Drifter QC:", check_maxtime("https://erddap.aoml.noaa.gov/gdp/erddap/info/drifter_6hour_qc/index.csv"))
print("Coriolis GOSUD:", check_maxtime("https://erddap.ifremer.fr/erddap/info/gosud/index.csv"))
print("Coriolis CTD:", check_maxtime("https://erddap.ifremer.fr/erddap/info/ArgoFloats-reference/index.csv"))
