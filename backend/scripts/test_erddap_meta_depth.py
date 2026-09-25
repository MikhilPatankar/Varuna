import requests
import pandas as pd
from io import StringIO

def check_vars(url):
    try:
        r = requests.get(url, timeout=10)
        df = pd.read_csv(StringIO(r.text))
        variables = df[df['Row Type'] == 'variable']['Variable Name'].tolist()
        
        matches = [v for v in variables if 'depth' in v.lower() or 'pres' in v.lower() or 'z' in v.lower()]
        return matches
    except Exception as e:
        return f"Error: {e}"

print("Argo:", check_vars("https://erddap.ifremer.fr/erddap/info/ArgoFloats/index.csv"))
print("GOSUD:", check_vars("https://erddap.ifremer.fr/erddap/info/gosud/index.csv"))
print("Glider IOOS:", check_vars("https://gliders.ioos.us/erddap/info/amelia-20180501T0000/index.csv"))
print("Drifter AOML:", check_vars("https://erddap.aoml.noaa.gov/gdp/erddap/info/drifter_6hour_qc/index.csv"))
