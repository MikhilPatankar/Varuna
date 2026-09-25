import urllib.request
import os

url = "ftp://jmax12:MasterPass%4000@nrt.cmems-du.eu/Core/INSITU_GLO_PHYBGCWAV_DISCRETE_MYNRT_013_030/cmems_obs-ins_glo_phybgcwav_mynrt_na_irr/index_latest.txt"

print(f"Downloading {url}...")
try:
    urllib.request.urlretrieve(url, "index_latest.txt")
    print("Downloaded successfully. File size:", os.path.getsize("index_latest.txt"))
except Exception as e:
    print(f"Error: {e}")
