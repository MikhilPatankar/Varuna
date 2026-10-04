from fastapi import APIRouter, Query, Depends, HTTPException
import duckdb
from polaris.api.deps import get_db

router = APIRouter(prefix="/api/v1/hazards", tags=["Cyclones"])

@router.get("/cyclones")
async def get_cyclones(
    bbox: str = Query(None),
    year: int = Query(None),
    cyclone_id: str = Query(None),
    date: str = Query(None, description="Format YYYY-MM-DD"),
    active_only: bool = Query(False),
    db: duckdb.DuckDBPyConnection = Depends(get_db)
):
    if not any([bbox, year, cyclone_id, date, active_only]):
        raise HTTPException(status_code=400, detail="Must provide at least one filter (e.g., year, active_only, cyclone_id)")

    conditions = []
    params = []
    
    if cyclone_id:
        conditions.append("storm_id = ?")
        params.append(cyclone_id)
    if active_only:
        conditions.append("is_current = TRUE")
    if year:
        conditions.append("season = ?")
        params.append(year)
    if date:
        conditions.append("CAST(observation_time AS DATE) = TRY_CAST(? AS DATE)")
        params.append(date)
    if bbox:
        try:
            coords = list(map(float, bbox.split(',')))
            if len(coords) != 4:
                raise ValueError()
            lon_min, lat_min, lon_max, lat_max = coords
            conditions.append(
                "ST_Intersects(geom, ST_MakeEnvelope(?, ?, ?, ?))"
            )
            params.extend([lon_min, lat_min, lon_max, lat_max])
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid bbox format. Expected lon_min,lat_min,lon_max,lat_max")
    
    where = " AND ".join(conditions) if conditions else "1=1"
    
    query = f"""
        SELECT storm_id as cyclone_id, name, basin, observation_time,
               lat, lon, max_wind_kts, min_pressure_hpa,
               storm_category, is_current
        FROM cyclones
        WHERE {where}
        QUALIFY ROW_NUMBER() OVER (PARTITION BY storm_id ORDER BY observation_time DESC) = 1
        ORDER BY storm_id
    """
    
    result = db.execute(query, params).fetchdf()
    result = result.fillna('')
    for col in result.select_dtypes(include=['datetime64']).columns:
        result[col] = result[col].astype(str)
    
    cyclones_list = []
    for _, row in result.iterrows():
        sid = row['cyclone_id']
        current_pos = None
        if row['is_current'] and str(row['lat']) != '':
            current_pos = {
                'lat': row['lat'], 'lon': row['lon'],
                'time': row['observation_time'],
                'wind_kts': row['max_wind_kts'],
                'pressure_hpa': row['min_pressure_hpa'],
                'category': row['storm_category']
            }
        cyclones_list.append({
            'cyclone_id': sid,
            'name': row['name'],
            'basin': row['basin'],
            'current_position': current_pos
        })
            
    return {
        "total_count": len(cyclones_list),
        "data": cyclones_list
    }


@router.get("/cyclone/{cyclone_id}")
async def get_cyclone_details(
    cyclone_id: str,
    db: duckdb.DuckDBPyConnection = Depends(get_db)
):
    query = """
        SELECT storm_id as cyclone_id, name, basin, observation_time,
               lat, lon, max_wind_kts, min_pressure_hpa,
               storm_category, storm_speed_kph, storm_dir_deg,
               wind_radii_json, is_current
        FROM cyclones
        WHERE storm_id = ?
        ORDER BY observation_time ASC
    """
    result = db.execute(query, [cyclone_id]).fetchdf()
    if result.empty:
        raise HTTPException(status_code=404, detail="Cyclone not found")
        
    result = result.fillna('')
    for col in result.select_dtypes(include=['datetime64']).columns:
        result[col] = result[col].astype(str)
        
    last_row = result.iloc[-1]
    
    import json as json_lib
    positions = []
    for _, row in result.iterrows():
        radii = row.get('wind_radii_json', '')
        parsed_radii = None
        if radii and isinstance(radii, str) and radii.strip():
            try:
                parsed_radii = json_lib.loads(radii)
            except Exception:
                parsed_radii = None
        positions.append({
            'lat': row['lat'], 'lon': row['lon'],
            'time': row['observation_time'],
            'wind_kts': row['max_wind_kts'],
            'pressure_hpa': row['min_pressure_hpa'],
            'category': row['storm_category'],
            'wind_radii': parsed_radii,
        })
    
    # Always expose the last known position, regardless of is_current flag
    current_pos = {
        **positions[-1],
        'is_current': bool(last_row['is_current'])
    } if positions else None
        
    return {
        'cyclone_id': last_row['cyclone_id'],
        'name': last_row['name'],
        'basin': last_row['basin'],
        'current_position': current_pos,
        'total_count': len(positions),
        'positions': positions
    }
