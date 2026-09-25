import requests

url = 'https://erddap.ifremer.fr/erddap/tabledap/ArgoFloats.csv?pres&platform_number="6903822"&orderByMinMax("pres")'
r = requests.get(url)
print(r.text)
