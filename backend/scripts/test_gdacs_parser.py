import requests
url = "https://api.cerulean.skytruth.org/collections/public.slick_plus/items?limit=1"
r = requests.get(url).json()
for link in r.get("links", []):
    if link.get("rel") == "next":
        print("Next URL:", link.get("href"))
