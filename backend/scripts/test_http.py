import urllib.request
import os

url = "https://nrt.cmems-du.eu/Core/INSITU_GLO_PHYBGCWAV_DISCRETE_MYNRT_013_030/cmems_obs-ins_glo_phybgcwav_mynrt_na_irr/index_latest.txt"

print(f"Downloading {url}...")
try:
    password_mgr = urllib.request.HTTPPasswordMgrWithDefaultRealm()
    password_mgr.add_password(None, url, 'jmax12', 'MasterPass@00')
    handler = urllib.request.HTTPBasicAuthHandler(password_mgr)
    opener = urllib.request.build_opener(handler)
    urllib.request.install_opener(opener)

    urllib.request.urlretrieve(url, "index_latest.txt")
    print("Downloaded successfully. File size:", os.path.getsize("index_latest.txt"))
except Exception as e:
    print(f"Error: {e}")
