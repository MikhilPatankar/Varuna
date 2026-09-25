import argparse
import sys
import asyncio
from pathlib import Path
from datetime import datetime, timedelta
from polaris.logger import logger

import os
import urllib.request
from polaris.config import GLOBAL_BOUNDS, RAW_DATA_DIR, DUCKDB_PATH

backend_dir = Path(__file__).parent.parent.resolve()
sys.path.insert(0, str(backend_dir))

from polaris.pipeline.ingestion import IngestionPipeline

def fetch_cmems():
    import copernicusmarine
    import os
    
    logger.info("Fetching latest CMEMS GLORYS12V1 (Global Ocean Physics) data...")
        
    # We fetch exactly 1 day from 1 month ago (30 days ago)
    # target_date_obj = datetime.utcnow() - timedelta(days=30)
    # target_date = target_date_obj.strftime("%Y-%m-%d")
    target_date = datetime.utcnow().strftime("%Y-%m-%d")
    
    cmems_targets = [
        # {"dataset_id": "cmems_mod_glo_phy-thetao_anfc_0.083deg_P1D-m", "var": "thetao"},
        # {"dataset_id": "cmems_mod_glo_phy-so_anfc_0.083deg_P1D-m", "var": "so"},
        {"dataset_id": "cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m", "var": "uo"},
        {"dataset_id": "cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m", "var": "vo"}
    ]
    
    for target in cmems_targets:
        dataset_id = target["dataset_id"]
        var_name = target["var"]
        
        out_file = f"cmems_{var_name}_{target_date}.nc"
        logger.info(f"--- Fetching {var_name} (Global for {target_date}) from {dataset_id} ---")
        
        try:
            copernicusmarine.subset(
                dataset_id=dataset_id,
                variables=[var_name],
                # Full Globe Coverage
                minimum_longitude=-180,
                maximum_longitude=179.99,
                minimum_latitude=-90,
                maximum_latitude=90,
                minimum_depth=0,
                maximum_depth=5000,
                # Single day
                start_datetime=f"{target_date} 00:00:00",
                end_datetime=f"{target_date} 23:59:59",
                output_filename=out_file,
                output_directory=str(RAW_DATA_DIR),
                force_download=True,
            )
            
            filepath = RAW_DATA_DIR / out_file
            logger.info(f"Download complete: {filepath}")
            
            # Now automatically ingest it!
            pipeline = IngestionPipeline()
            result = pipeline.ingest(str(filepath), tier="daily", time_key=target_date)
            logger.info(f"Ingestion complete for {var_name}. Result: {result}")
            
            # Clean up raw file to prevent out-of-disk-space errors
            try:
                os.remove(filepath)
                logger.info(f"Deleted raw temporary file: {out_file} to save space.")
            except Exception as cleanup_err:
                logger.warning(f"Could not delete {out_file}: {cleanup_err}")
            
        except Exception as e:
            logger.error(f"Error downloading {var_name}: {e}")
            logger.info("Make sure you have authenticated using 'copernicusmarine login'")

def fetch_ibtracs():
    
    logger.info("Fetching latest NOAA IBTrACS global hurricane data...")
    # URL for the global CSV containing all historical tracks
    url = "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r00/access/csv/ibtracs.ALL.list.v04r00.csv"
    
    out_file = "ibtracs.ALL.list.v04r00.csv"
    filepath = RAW_DATA_DIR / out_file
    
    try:
        logger.info(f"Downloading {url} to {filepath}...")
        # NOAA can be slow, this might take a minute for ~150MB
        urllib.request.urlretrieve(url, str(filepath))
        logger.info("Download complete. Starting ingestion pipeline...")
        
        pipeline = IngestionPipeline()
        result = pipeline.ingest(str(filepath))
        logger.info(f"Ingestion complete for IBTrACS. Result: {result}")
        
        # Clean up
        try:
            os.remove(filepath)
            logger.info("Deleted raw IBTrACS file to save space.")
        except Exception as cleanup_err:
            logger.warning(f"Could not delete {filepath}: {cleanup_err}")
            
    except Exception as e:
        logger.error(f"Failed to fetch or ingest IBTrACS: {e}")


def fetch_gdacs():
    import requests
    import pandas as pd
    import duckdb
    import datetime
    import xml.etree.ElementTree as ET
    import re
    from polaris.config import DUCKDB_PATH
    
    logger.info("Fetching all tropical cyclones from GDACS API (2025-Present)...")
    
    # 1. Collect event IDs from JSON SEARCH API (Historical 2025-Present)
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    url = f"https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC&fromdate=2025-01-01&todate={now}"
    
    event_ids = set()
    try:
        response = requests.get(url, timeout=30)
        data = response.json()
        for feature in data.get('features', []):
            eid = str(feature.get('properties', {}).get('eventid', ''))
            if eid:
                event_ids.add(eid)
    except Exception as e:
        logger.error(f"Failed to fetch GDACS JSON: {e}")
        
    # 2. Collect event IDs from RSS feed (Currently Active)
    active_ids = set()
    rss_url = "https://www.gdacs.org/xml/rss.xml"
    try:
        rss_response = requests.get(rss_url, timeout=30)
        root = ET.fromstring(rss_response.content)
        for item in root.findall('.//item'):
            title = item.find('title').text or ""
            if 'Cyclone' in title or 'Tropical' in title:
                gdacs_eventid = item.find('{http://www.gdacs.org}eventid')
                if gdacs_eventid is not None and gdacs_eventid.text:
                    eid = str(gdacs_eventid.text)
                    event_ids.add(eid)
                    active_ids.add(eid)
    except Exception as e:
        logger.error(f"Failed to fetch GDACS RSS: {e}")
        
    records = []
    
    # 3. For each unique event ID, fetch the full trajectory
    logger.info(f"Found {len(event_ids)} unique cyclones. Fetching trajectories...")
    for eid in event_ids:
        try:
            url_data = f"https://www.gdacs.org/gdacsapi/api/events/geteventdata?eventtype=TC&eventid={eid}"
            res_data = requests.get(url_data, timeout=30).json()
            props = res_data.get('properties', {})
            
            raw_name = props.get('eventname', '')
            name = raw_name.split('-')[0] if raw_name else 'UNKNOWN'
            
            is_current = eid in active_ids
            
            # Find timeline URL
            timeline_url = None
            for impact in props.get('impacts', []):
                res = impact.get('resource', {})
                if 'timeline' in res:
                    timeline_url = res['timeline']
                    break
                    
            if not timeline_url:
                continue
                
            timeline_data = requests.get(timeline_url, timeout=30).json()
            items = timeline_data.get('channel', {}).get('item', [])
            
            for item in items:
                if str(item.get('actual')).lower() != 'true':
                    continue
                
                lat = float(item.get('latitude', 0))
                lon = float(item.get('longitude', 0))
                
                wind_ms = float(item.get('wind_speed', 0))
                wind_kts = wind_ms * 1.94384 if wind_ms > 0 else None
                
                pressure = float(item.get('pressure', 0))
                if pressure <= 0: pressure = None
                
                date_str = item.get('advisory_datetime')
                if not date_str:
                    continue
                obs_time = pd.to_datetime(date_str).strftime('%Y-%m-%dT%H:%M:%S')
                season = pd.to_datetime(date_str).year
                
                basin = 'Unknown'
                if lat >= 0:
                    if -100 <= lon <= -40: basin = 'NA'
                    elif -180 <= lon < -100: basin = 'EP'
                    elif 100 <= lon <= 180: basin = 'WP'
                    elif 40 <= lon < 100: basin = 'NI'
                else:
                    if 20 <= lon < 90: basin = 'SI'
                    elif 90 <= lon <= 180 or -180 <= lon < -120: basin = 'SP'
                    elif -50 <= lon < 20: basin = 'SA'
                    
                alertcolor = item.get('alertcolor', 'Unknown').capitalize()
                
                records.append({
                    'storm_id': 'GDACS_' + eid,
                    'name': name.upper(),
                    'basin': basin,
                    'season': season,
                    'observation_time': obs_time,
                    'lat': lat,
                    'lon': lon,
                    'max_wind_kts': wind_kts,
                    'min_pressure_hpa': pressure,
                    'storm_category': alertcolor,
                    'storm_speed_kph': float(item.get('track_speed', 0)) if item.get('track_speed') else None,
                    'storm_dir_deg': float(item.get('track_heading', 0)) if item.get('track_heading') else None,
                    'source': 'gdacs',
                    'is_current': is_current
                })
        except Exception as e:
            logger.warning(f"Failed to process trajectory for GDACS event {eid}: {e}")
            
        if not records:
            logger.info("No active cyclones found on GDACS.")
            return
            
        df = pd.DataFrame(records)
        con = duckdb.connect(str(DUCKDB_PATH))
        con.execute("INSTALL spatial;")
        con.execute("LOAD spatial;")
        
        con.execute("DELETE FROM cyclones WHERE source = 'gdacs'")
        
        con.execute("""
            INSERT INTO cyclones (storm_id, name, basin, season,
                observation_time, lat, lon, max_wind_kts, min_pressure_hpa,
                storm_category, storm_speed_kph, storm_dir_deg, source, geom, is_current)
            SELECT 
                storm_id, name, basin, season,
                TRY_CAST(observation_time AS TIMESTAMP), lat, lon, 
                TRY_CAST(max_wind_kts AS DOUBLE), 
                TRY_CAST(min_pressure_hpa AS DOUBLE),
                storm_category, 
                TRY_CAST(storm_speed_kph AS DOUBLE), 
                TRY_CAST(storm_dir_deg AS DOUBLE),
                source, ST_Point(lon, lat), is_current
            FROM df
        """)
        con.close()
        
        logger.info(f"Ingested {len(df)} active cyclones from GDACS.")
        

def fetch_skytruth():
    import requests
    import pandas as pd
    import duckdb
    import json
    from datetime import datetime, timedelta
    from polaris.config import DUCKDB_PATH
    
    logger.info("Fetching latest oil spills from SkyTruth Cerulean API...")
    
    end = datetime.utcnow()
    start = end - timedelta(days=7)
    dt_str = f"{start.strftime('%Y-%m-%dT%H:%M:%SZ')}/{end.strftime('%Y-%m-%dT%H:%M:%SZ')}"
    
    url = "https://api.cerulean.skytruth.org/collections/public.slick_plus/items"
    params = {
        "limit": 100,
        "datetime": dt_str
    }
    
    records = []
    
    try:
        while url:
            r = requests.get(url, params=params, timeout=30)
            if r.status_code != 200:
                logger.error(f"SkyTruth API failed: {r.status_code} {r.text}")
                break
                
            data = r.json()
            features = data.get('features', [])
            
            for feat in features:
                props = feat.get('properties', {})
                geom = feat.get('geometry')
                
                if not geom or not props:
                    continue
                    
                slick_id = props.get('id')
                if not slick_id:
                    continue
                    
                obs_time = props.get('slick_timestamp')
                confidence = props.get('machine_confidence', 0)
                
                severity = 'unknown'
                if confidence > 0.8: severity = 'high'
                elif confidence > 0.5: severity = 'medium'
                else: severity = 'low'
                
                records.append({
                    'event_id': int(slick_id),
                    'name': f"SkyTruth Oil Slick #{slick_id}",
                    'hazard_type': 'oil_spill',
                    'severity': severity,
                    'start_time': obs_time,
                    'end_time': obs_time,
                    'properties_json': json.dumps(props),
                    'source': 'SkyTruth Cerulean',
                    'geom_geojson': json.dumps(geom)
                })
                
            # Pagination
            next_url = None
            for link in data.get('links', []):
                if link.get('rel') == 'next':
                    next_url = link.get('href')
                    break
            
            url = next_url
            params = None # The next_url already contains the query parameters
            
        logger.info(f"Found {len(records)} SkyTruth slicks in the last 7 days.")
        
        if not records:
            return
            
        df = pd.DataFrame(records)
        con = duckdb.connect(str(DUCKDB_PATH))
        con.execute("INSTALL spatial;")
        con.execute("LOAD spatial;")
        
        con.execute("DELETE FROM hazard_events WHERE source = 'SkyTruth Cerulean'")
        
        con.execute("""
            INSERT INTO hazard_events (event_id, hazard_type, name, severity,
                start_time, end_time, properties_json, source, geom)
            SELECT 
                event_id, hazard_type, name, severity,
                TRY_CAST(start_time AS TIMESTAMP), TRY_CAST(end_time AS TIMESTAMP),
                properties_json, source, ST_GeomFromGeoJSON(geom_geojson)
            FROM df
        """)
        con.close()
        logger.info(f"Ingested {len(records)} SkyTruth slicks into hazard_events.")
        
    except Exception as e:
        logger.error(f"Failed to fetch or ingest SkyTruth data: {e}")

def fetch_spills():
    
    logger.info("Fetching latest NOAA IncidentNews oil spill data...")
    # NOAA IncidentNews raw CSV export
    url = "https://incidentnews.noaa.gov/raw/incidents.csv"
    
    out_file = "noaa_incidents.csv"
    filepath = RAW_DATA_DIR / out_file
    
    try:
        logger.info(f"Downloading {url} to {filepath}...")
        # Custom user agent to prevent NOAA blocking standard urllib requests
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response, open(filepath, 'wb') as out_f:
            out_f.write(response.read())
            
        logger.info("Download complete. Starting ingestion pipeline...")
        
        pipeline = IngestionPipeline()
        result = pipeline.ingest(str(filepath))
        logger.info(f"Ingestion complete for Oil Spills. Result: {result}")
        
        try:
            os.remove(filepath)
            logger.info("Deleted raw Spills file to save space.")
        except Exception as cleanup_err:
            logger.warning(f"Could not delete {filepath}: {cleanup_err}")
            
    except Exception as e:
        logger.error(f"Failed to fetch or ingest Spills: {e}")

def fetch_bathymetry():
    import copernicusmarine
    import os
    from polaris.pipeline.ingestion import IngestionPipeline

    logger.info("Fetching CMEMS static bathymetry (one-time)...")

    out_file = "cmems_bathymetry_static.nc"
    filepath = RAW_DATA_DIR / out_file

    try:
        copernicusmarine.subset(
            dataset_id="cmems_mod_glo_phy_my_0.083deg_static",
            variables=["deptho", "mask"],
            minimum_longitude=GLOBAL_BOUNDS['lon_min'],
            maximum_longitude=GLOBAL_BOUNDS['lon_max'],
            minimum_latitude=GLOBAL_BOUNDS['lat_min'],
            maximum_latitude=GLOBAL_BOUNDS['lat_max'],
            output_filename=out_file,
            output_directory=str(RAW_DATA_DIR),
            force_download=True,
        )
        logger.info(f"Download complete: {filepath}")

        try:
            import xarray as xr
            import rioxarray
            
            logger.info("Converting NetCDF to GeoTIFF for 3D Terrain Compiler...")
            ds = xr.open_dataset(filepath)
            data_array = ds['deptho']
            
            # 1. Handle Values: CMEMS deptho is positive below sea level. 
            # 3D terrain engines expect elevations (so ocean should be negative).
            data_array = -data_array
            
            # 2. Handle Land: Replace NaNs (land) with 0.0 (sea level) so skirts blend cleanly.
            data_array = data_array.fillna(0.0)
            
            # 3. Ensure spatial dimensions are correct for rioxarray
            if 'latitude' in data_array.dims and 'longitude' in data_array.dims:
                data_array = data_array.rename({'latitude': 'y', 'longitude': 'x'})
            elif 'lat' in data_array.dims and 'lon' in data_array.dims:
                data_array = data_array.rename({'lat': 'y', 'lon': 'x'})
                
            # 4. Correct Alignment: GeoTIFFs strictly expect Top-Left origin (North to South).
            if data_array.y[0] < data_array.y[-1]:
                data_array = data_array.isel(y=slice(None, None, -1))
                
            # 5. Export with standard EPSG:4326 CRS
            data_array = data_array.rio.write_crs("EPSG:4326")
            tif_path = RAW_DATA_DIR / "cmems_bathymetry_static.tif"
            data_array.rio.to_raster(tif_path)
            
            logger.info(f"Successfully generated perfect GeoTIFF for terrain compiling: {tif_path}")
            ds.close()
        except Exception as e:
            logger.error(f"Failed to create GeoTIFF: {e}")

        pipeline = IngestionPipeline()
        result = pipeline.ingest(str(filepath), tier="static", time_key="static")
        logger.info(f"Ingestion complete for bathymetry. Result: {result}")

        try:
            os.remove(filepath)
            logger.info("Deleted raw bathymetry NetCDF to save space.")
        except Exception as e:
            logger.warning(f"Could not delete {filepath}: {e}")

    except Exception as e:
        logger.error(f"Failed to fetch or ingest bathymetry: {e}")
        logger.info("Make sure you have authenticated using 'copernicusmarine login'")

def _clear_insitu_data():
    import duckdb
    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute("LOAD spatial;")
    logger.info("Clearing stale in-situ instruments and profiles...")
    con.execute("DELETE FROM profiles")
    con.execute("DELETE FROM instruments")
    con.close()
    logger.info("In-situ data cleared.")


def _ingest_df(df: "pd.DataFrame", pipeline: "IngestionPipeline", label: str, out_path: "Path") -> None:
    """Save df to CSV and run through the ingestion pipeline, then delete the temp file."""
    df.to_csv(out_path, index=False)
    res = pipeline.ingest(str(out_path))
    logger.info(f"  Ingestion complete for {label}. Result: {res}")
    try:
        os.remove(out_path)
    except Exception:
        pass


def fetch_insitu():
    import pandas as pd
    import requests
    from io import StringIO

    now = pd.Timestamp.utcnow()
    start_30d = (now - pd.Timedelta(days=30)).strftime('%Y-%m-%dT%H:%M:%SZ')
    start_date = (now - pd.Timedelta(days=30)).strftime('%Y-%m-%d')

    # ─── Wipe stale data ────────────────────────────────────────────────────────
    _clear_insitu_data()
    pipeline = IngestionPipeline()

    # ─── 1. ARGO FLOATS — Coriolis GDAC ERDDAP ──────────────────────────────────
    # Instrument types covered: Argo float (BGC + Core), Ice Tethered Profilers
    logger.info("1/6  Fetching Argo Floats (Coriolis GDAC ERDDAP)...")
    try:
        from argopy import IndexFetcher
        idx = IndexFetcher(src='erddap').region([-180, 180, -90, 90, start_date, now.strftime('%Y-%m-%d')]).to_dataframe()
        if not idx.empty:
            df = idx.rename(columns={
                'wmo': 'instrument_id', 'date': 'observation_time',
                'latitude': 'lat', 'longitude': 'lon',
            })
            df['instrument_type'] = 'Argo float'
            df = df[['instrument_id', 'instrument_type', 'lat', 'lon', 'observation_time']].dropna(subset=['lat', 'lon'])
            _ingest_df(df, pipeline, "Argo Floats", RAW_DATA_DIR / "argo_tmp.csv")
            logger.info(f"  => {len(df)} Argo float observations")
    except Exception as e:
        logger.error(f"Argo fetch failed: {e}")

    # ─── 2. GLIDERS — OceanGliders GDAC (Coriolis) + IOOS DAC ──────────────────
    # Instrument types covered: Glider (Autonomous Underwater Vehicle)
    logger.info("2/6  Fetching Gliders (OceanGliders GDAC + IOOS DAC)...")
    glider_dfs = []

    # 2a. OceanGliders GDAC via Coriolis ERDDAP
    try:
        GDAC_URL = (
            "https://erddap.ifremer.fr/erddap/tabledap/OceanGlidersGDACTrajectories.csv"
            f"?platform_code,time,latitude,longitude,platform_type"
            f"&time>={start_30d}&distinct()"
        )
        r = requests.get(GDAC_URL, timeout=60)
        if r.status_code == 200:
            g = pd.read_csv(StringIO(r.text), skiprows=[1])
            g = g.rename(columns={'platform_code': 'instrument_id', 'time': 'observation_time',
                                   'latitude': 'lat', 'longitude': 'lon'})
            g['instrument_type'] = 'Glider'
            g = g[['instrument_id', 'instrument_type', 'lat', 'lon', 'observation_time']].dropna(subset=['lat', 'lon'])
            glider_dfs.append(g)
            logger.info(f"  OceanGliders GDAC: {len(g)} observations")
    except Exception as e:
        logger.warning(f"  OceanGliders GDAC fetch failed: {e}")

    # 2b. IOOS Glider DAC
    try:
        meta_url = "https://data.ioos.us/gliders/erddap/tabledap/allDatasets.csv?datasetID,maxTime"
        d_df = pd.read_csv(meta_url, skiprows=[1])
        d_df['maxTime'] = pd.to_datetime(d_df['maxTime'], errors='coerce', utc=True)
        active = d_df[d_df['maxTime'] > (now - pd.Timedelta(days=30))]
        logger.info(f"  IOOS: {len(active)} active glider missions")
        for d_id in active['datasetID']:
            try:
                g_url = (f"https://data.ioos.us/gliders/erddap/tabledap/{d_id}.csv"
                         f"?time,latitude,longitude&time>={start_30d}")
                g_df = pd.read_csv(g_url, skiprows=[1])
                g_df = g_df.rename(columns={'time': 'observation_time', 'latitude': 'lat', 'longitude': 'lon'})
                g_df = g_df.dropna(subset=['lat', 'lon', 'observation_time'])
                g_df['instrument_id'] = d_id
                g_df['instrument_type'] = 'Glider'
                glider_dfs.append(g_df[['instrument_id', 'instrument_type', 'lat', 'lon', 'observation_time']])
            except Exception:
                pass
    except Exception as e:
        logger.warning(f"  IOOS Glider DAC fetch failed: {e}")

    if glider_dfs:
        merged = pd.concat(glider_dfs, ignore_index=True)
        _ingest_df(merged, pipeline, "Gliders", RAW_DATA_DIR / "gliders_tmp.csv")
        logger.info(f"  => {len(merged)} total Glider observations")

    # ─── 3. DRIFTERS — AOML Global Drifter Program ERDDAP ───────────────────────
    # Instrument types covered: Surface drifter (SVP buoys)
    # Note: AOML QC dataset is delayed-mode (max time ~2025). We fetch the last 30 days
    # of available data and time-shift it to 'now' for the Digital Twin simulation.
    logger.info("3/6  Fetching Drifters (AOML GDP ERDDAP)...")
    try:
        # Max time is ~2025-06-18, so we fetch from 2025-05-18 to 2025-06-18
        # We will dynamically just get the last 30 days relative to its maxTime
        info_url = "https://erddap.aoml.noaa.gov/gdp/erddap/info/drifter_6hour_qc/index.csv"
        info_df = pd.read_csv(info_url)
        max_time_str = info_df[info_df['Attribute Name'] == 'time_coverage_end']['Value'].values[0]
        max_time = pd.to_datetime(max_time_str)
        start_time = max_time - pd.Timedelta(days=30)
        
        DRIFTER_URL = (
            "https://erddap.aoml.noaa.gov/gdp/erddap/tabledap/drifter_6hour_qc.csv"
            f"?ID,time,longitude,latitude,typebuoy"
            f"&time>={start_time.strftime('%Y-%m-%dT%H:%M:%SZ')}"
            f"&time<={max_time.strftime('%Y-%m-%dT%H:%M:%SZ')}"
            f"&orderBy(%22ID,time%22)"
        )
        r = requests.get(DRIFTER_URL, timeout=120)
        if r.status_code == 200:
            df = pd.read_csv(StringIO(r.text), skiprows=[1])
            df = df.rename(columns={'ID': 'instrument_id', 'time': 'observation_time',
                                     'latitude': 'lat', 'longitude': 'lon'})
            df['instrument_type'] = df.get('typebuoy', pd.Series(['Drifter'] * len(df))).fillna('Drifter')
            
            # Time shift to simulate NRT
            time_diff = now - max_time
            df['observation_time'] = pd.to_datetime(df['observation_time']) + time_diff
            df['observation_time'] = df['observation_time'].dt.strftime('%Y-%m-%dT%H:%M:%SZ')
            
            df = df[['instrument_id', 'instrument_type', 'lat', 'lon', 'observation_time']].dropna(subset=['lat', 'lon'])
            
            # Subsample to keep it light (take last location per day per drifter)
            df['day'] = pd.to_datetime(df['observation_time']).dt.date
            df = df.drop_duplicates(subset=['instrument_id', 'day'], keep='last').drop(columns=['day'])
            
            _ingest_df(df, pipeline, "Drifters", RAW_DATA_DIR / "drifters_tmp.csv")
            logger.info(f"  => {len(df)} Drifter observations (time-shifted)")
        else:
            logger.warning(f"  Drifter ERDDAP returned status {r.status_code}")
    except Exception as e:
        logger.error(f"Drifter fetch failed: {e}")

    # ─── 4. THERMOSALINOMETER / FERRYBOX / XBT / SURFACE UNDERWAY — GOSUD ───────
    logger.info("4/6  Fetching Surface Underway data (GOSUD via Coriolis ERDDAP)...")
    try:
        # GOSUD uses ship_call_sign
        GOSUD_URL = (
            "https://erddap.ifremer.fr/erddap/tabledap/gosud.csv"
            f"?ship_call_sign,time,latitude,longitude"
            f"&time>={start_30d}&distinct()"
        )
        r = requests.get(GOSUD_URL, timeout=120)
        if r.status_code == 200:
            df = pd.read_csv(StringIO(r.text), skiprows=[1])
            df = df.rename(columns={'ship_call_sign': 'instrument_id', 'time': 'observation_time',
                                     'latitude': 'lat', 'longitude': 'lon'})
            
            # We don't have instrument_type in this query, we'll assign randomly or just 'Thermosalinometer'
            df['instrument_type'] = 'Thermosalinometer'
            
            # Subsample to keep it light (take last location per day per ship)
            df = df.dropna(subset=['lat', 'lon', 'instrument_id'])
            df['day'] = pd.to_datetime(df['observation_time']).dt.date
            df = df.drop_duplicates(subset=['instrument_id', 'day'], keep='last').drop(columns=['day'])
            
            df = df[['instrument_id', 'instrument_type', 'lat', 'lon', 'observation_time']]
            _ingest_df(df, pipeline, "Surface Underway (GOSUD)", RAW_DATA_DIR / "gosud_tmp.csv")
            logger.info(f"  => {len(df)} Surface Underway observations")
        else:
            logger.warning(f"  GOSUD returned status {r.status_code}")
    except Exception as e:
        logger.error(f"GOSUD fetch failed: {e}")

    # ─── 5. CTD (Reference) — Argo Reference CTD (Coriolis) ─────────────────────
    # Note: Argo Reference CTD dataset is delayed-mode (max time ~2022). We time-shift it.
    logger.info("5/6  Fetching CTD Reference data (Coriolis ERDDAP)...")
    try:
        info_url = "https://erddap.ifremer.fr/erddap/info/ArgoFloats-reference/index.csv"
        info_df = pd.read_csv(info_url)
        max_time_str = info_df[info_df['Attribute Name'] == 'time_coverage_end']['Value'].values[0]
        max_time = pd.to_datetime(max_time_str)
        start_time = max_time - pd.Timedelta(days=30)
        
        CTD_URL = (
            "https://erddap.ifremer.fr/erddap/tabledap/ArgoFloats-reference.csv"
            f"?platform_number,time,latitude,longitude"
            f"&time>={start_time.strftime('%Y-%m-%dT%H:%M:%SZ')}"
            f"&time<={max_time.strftime('%Y-%m-%dT%H:%M:%SZ')}"
            f"&distinct()"
        )
        r = requests.get(CTD_URL, timeout=120)
        if r.status_code == 200:
            df = pd.read_csv(StringIO(r.text), skiprows=[1])
            df = df.rename(columns={'platform_number': 'instrument_id', 'time': 'observation_time',
                                     'latitude': 'lat', 'longitude': 'lon'})
            df['instrument_type'] = 'CTD'
            
            # Time shift to simulate NRT
            time_diff = now - max_time
            df['observation_time'] = pd.to_datetime(df['observation_time']) + time_diff
            df['observation_time'] = df['observation_time'].dt.strftime('%Y-%m-%dT%H:%M:%SZ')
            
            df = df[['instrument_id', 'instrument_type', 'lat', 'lon', 'observation_time']].dropna(subset=['lat', 'lon'])
            
            # Subsample
            df['day'] = pd.to_datetime(df['observation_time']).dt.date
            df = df.drop_duplicates(subset=['instrument_id', 'day'], keep='last').drop(columns=['day'])
            
            _ingest_df(df, pipeline, "CTD Reference", RAW_DATA_DIR / "ctd_tmp.csv")
            logger.info(f"  => {len(df)} CTD observations (time-shifted)")
        else:
            logger.warning(f"  CTD ERDDAP returned status {r.status_code}")
    except Exception as e:
        logger.error(f"CTD fetch failed: {e}")

    # ─── 6. MOORINGS / BUOYS — NOAA NDBC ────────────────────────────────────────
    # Instrument types covered: Mooring (fixed buoys), Wave buoys, Met buoys
    logger.info("6/6  Fetching Mooring/Buoy positions (NOAA NDBC)...")
    try:
        NDBC_URL = "https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt"
        r = requests.get(NDBC_URL, timeout=30)
        if r.status_code == 200:
            # Parse NDBC fixed-width format
            lines = [l for l in r.text.splitlines() if not l.startswith('#')]
            header = lines[0].split()
            records = []
            for line in lines[1:]:
                parts = line.split()
                if len(parts) >= 3:
                    try:
                        records.append({
                            'instrument_id': parts[0],
                            'lat': float(parts[1]),
                            'lon': float(parts[2]),
                        })
                    except (ValueError, IndexError):
                        pass
            df = pd.DataFrame(records)
            df['instrument_type'] = 'Mooring'
            df['observation_time'] = now.isoformat()
            df = df[['instrument_id', 'instrument_type', 'lat', 'lon', 'observation_time']].dropna(subset=['lat', 'lon'])
            _ingest_df(df, pipeline, "NDBC Moorings", RAW_DATA_DIR / "ndbc_tmp.csv")
            logger.info(f"  => {len(df)} Mooring/Buoy positions")
        else:
            logger.warning(f"  NDBC returned status {r.status_code}")
    except Exception as e:
        logger.error(f"NDBC Mooring fetch failed: {e}")

    logger.info("fetch_insitu complete. All instrument types processed.")



def main():
    parser = argparse.ArgumentParser(description="Fetch ocean data for POLARIS.")
    parser.add_argument("--source", choices=["cmems", "ibtracs", "gdacs", "spills", "insitu", "bathymetry"], required=True, help="Data source to fetch from.")
    
    args = parser.parse_args()
    
    if args.source == "cmems":
        fetch_cmems()
    elif args.source == "ibtracs":
        fetch_ibtracs()
        fetch_gdacs()
    elif args.source == "gdacs":
        fetch_gdacs()
    elif args.source == "spills":
        fetch_skytruth()
        fetch_spills()
    elif args.source == "insitu":
        fetch_insitu()
    elif args.source == "bathymetry":
        fetch_bathymetry()

if __name__ == "__main__":
    main()
