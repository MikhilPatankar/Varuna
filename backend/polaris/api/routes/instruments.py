from fastapi import APIRouter, Query, Depends
import duckdb
from polaris.api.deps import get_db

router = APIRouter(prefix="/api/v1", tags=["Instruments"])

@router.get("/instruments")
async def get_instruments(
    bbox: str = Query(None, description="lon_min,lat_min,lon_max,lat_max"),
    instrument_type: str = Query(None),
    status: str = Query(None),
    db: duckdb.DuckDBPyConnection = Depends(get_db)
):
    query = """
        SELECT i.instrument_id, i.instrument_type,
               p.lon, p.lat,
               p.observation_time as last_report, i.metadata_json
        FROM instruments i
        LEFT JOIN (
            SELECT CAST(instrument_id AS VARCHAR) as instrument_id, lon, lat, observation_time
            FROM profiles
            QUALIFY ROW_NUMBER() OVER (PARTITION BY instrument_id ORDER BY observation_time DESC) = 1
        ) p ON i.instrument_id = p.instrument_id
        WHERE 1=1
    """
    params = []
    
    if bbox:
        try:
            coords = list(map(float, bbox.split(',')))
            if len(coords) != 4:
                raise ValueError()
            lon_min, lat_min, lon_max, lat_max = coords
            query += " AND p.lon >= ? AND p.lon <= ? AND p.lat >= ? AND p.lat <= ?"
            params.extend([lon_min, lon_max, lat_min, lat_max])
        except ValueError:
            from fastapi import HTTPException
            raise HTTPException(status_code=400, detail="Invalid bbox format. Expected lon_min,lat_min,lon_max,lat_max")
        
    if instrument_type:
        query += " AND instrument_type = ?"
        params.append(instrument_type)
        
    if status:
        query += " AND status = ?"
        params.append(status)
        
    result = db.execute(query, params).fetchdf()
    # Convert datetime objects and NaNs for JSON serialization
    result = result.fillna('')
    for col in result.select_dtypes(include=['datetime64']).columns:
        result[col] = result[col].astype(str)
        
    records = result.to_dict(orient='records')
    return {
        "total_count": len(records),
        "data": records
    }


@router.get("/instruments/{instrument_id}/profile")
async def get_instrument_profile(
    instrument_id: str,
    time_start: str = Query(None),
    time_end: str = Query(None),
    db: duckdb.DuckDBPyConnection = Depends(get_db)
):
    # Fetch instrument metadata first
    meta_query = "SELECT instrument_type FROM instruments WHERE instrument_id = ?"
    meta_res = db.execute(meta_query, [instrument_id]).fetchone()
    
    inst_type = meta_res[0] if meta_res else "Unknown"

    query = """
        SELECT lat, lon, depth, temperature, salinity, dissolved_oxygen,
               chlorophyll, observation_time
        FROM profiles
        WHERE instrument_id = ?
    """
    params = [instrument_id]
    
    if time_start:
        query += " AND observation_time >= TRY_CAST(? AS TIMESTAMP)"
        params.append(time_start)
    if time_end:
        query += " AND observation_time <= TRY_CAST(? AS TIMESTAMP)"
        params.append(time_end)
        
    query += " ORDER BY depth ASC, observation_time DESC"
    result = db.execute(query, params).fetchdf()
    
    if not result.empty:
        import pandas as pd
        result['obs_dt'] = pd.to_datetime(result['observation_time'])
        result = result.sort_values('obs_dt', ascending=True)
        result['day'] = result['obs_dt'].dt.floor('D')
        result = result.drop_duplicates(subset=['day'], keep='last')
        result.set_index('day', inplace=True)
        
        min_day = result.index.min()
        max_day = result.index.max()
        if pd.notnull(min_day) and pd.notnull(max_day):
            full_range = pd.date_range(start=min_day, end=max_day, freq='D')
            result = result.reindex(full_range)
            result = result.ffill()
            result['observation_time'] = result.index.strftime('%Y-%m-%d %H:%M:%S')
            
        result = result.sort_index(ascending=False)
        result = result.reset_index(drop=True)
        result.drop(columns=['obs_dt'], inplace=True, errors='ignore')

    result = result.fillna('')
    for col in result.select_dtypes(include=['datetime64']).columns:
        result[col] = result[col].astype(str)
    # Define which instruments collect which variables
    instrument_caps = {
        'Argo float': ['temperature', 'salinity', 'depth', 'dissolved_oxygen', 'chlorophyll', 'nitrate', 'phosphate'],
        'Glider': ['temperature', 'salinity', 'depth', 'dissolved_oxygen', 'chlorophyll'],
        'CTD': ['temperature', 'salinity', 'depth', 'dissolved_oxygen', 'chlorophyll'],
        'Thermosalinometer': ['temperature', 'salinity', 'depth'],
        'FerryBox': ['temperature', 'salinity', 'depth', 'dissolved_oxygen', 'chlorophyll'],
        'Mooring': ['temperature', 'salinity', 'depth', 'u_current', 'v_current'],
        'XBT': ['temperature', 'depth'],
        'SVP': ['temperature', 'depth', 'u_current', 'v_current'],
        'SVPB': ['temperature', 'depth', 'u_current', 'v_current'],
        'SVPBV': ['temperature', 'salinity', 'depth', 'u_current', 'v_current'],
    }
    caps = instrument_caps.get(inst_type, ['temperature', 'depth'])

    from polaris.api.routes.data import get_cached_dataset
    
    result_list = result.to_dict(orient='records')
    
    all_possible_vars = [
        'temperature', 'salinity', 'depth', 'dissolved_oxygen', 
        'chlorophyll', 'nitrate', 'phosphate', 'u_current', 'v_current'
    ]
    
    for row in result_list:
        # Strip all environment variables that came from SQL or default list
        for k in all_possible_vars:
            if k in row:
                del row[k]
                
        # Add back ONLY the variables this specific instrument is capable of collecting
        for k in caps:
            row[k] = ""
            
        try:
            # Extract date portion for time_key, e.g. '2026-09-22'
            obs_date = row['observation_time'].split(" ")[0]
            lat = float(row['lat'])
            lon = float(row['lon'])
            
            # Fetch Temperature if instrument supports it
            if 'temperature' in caps:
                ds_temp = get_cached_dataset('temperature', 'daily', obs_date)
                if ds_temp is not None:
                    try:
                        # Nearest neighbor lookup at surface (depth=0.0)
                        val = ds_temp['temperature'].sel(lat=lat, lon=lon, depth=0.0, method='nearest').values
                        row['temperature'] = round(float(val.item()), 2)
                    except Exception:
                        pass
                        
            # Fetch Salinity if instrument supports it
            if 'salinity' in caps:
                ds_sal = get_cached_dataset('salinity', 'daily', obs_date)
                if ds_sal is not None:
                    try:
                        val = ds_sal['salinity'].sel(lat=lat, lon=lon, depth=0.0, method='nearest').values
                        row['salinity'] = round(float(val.item()), 2)
                    except Exception:
                        pass
        except Exception:
            pass
        
    # Define standard operating depth ranges (in meters) for each instrument
    depth_ranges = {
        'Argo float': 2000.0,
        'Glider': 1000.0,
        'CTD': 5000.0,
        'Mooring': 5000.0,
        'XBT': 760.0,
        'Thermosalinometer': 0.0,
        'FerryBox': 0.0,
        'SVP': 0.0,
        'SVPB': 0.0,
        'SVPBV': 0.0,
    }
    max_depth = depth_ranges.get(inst_type, 0.0)

    return {
        'instrument_id': instrument_id,
        'instrument_type': inst_type,
        'operating_depth_min': 0.0,
        'operating_depth_max': max_depth,
        'total_count': len(result_list),
        'profiles': result_list
    }
