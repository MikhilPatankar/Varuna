from fastapi import APIRouter, Query, Depends
import duckdb
import json
from polaris.api.deps import get_db

router = APIRouter(prefix="/api/v1", tags=["Hazards"])

@router.get("/hazards/{hazard_type}")
async def get_hazards(
    hazard_type: str,
    bbox: str = Query(None),
    severity: str = Query(None),
    year: int = Query(None),
    date: str = Query(None, description="Format YYYY-MM-DD"),
    include_geom: bool = Query(False, description="Include full GeoJSON geometry for polygons"),
    db: duckdb.DuckDBPyConnection = Depends(get_db)
):
    geom_sql = "ST_AsGeoJSON(geom) as geom_geojson," if include_geom else ""
    query = f"""
        SELECT event_id, name, severity, start_time, end_time,
               ST_X(ST_Centroid(geom)) as lon, ST_Y(ST_Centroid(geom)) as lat,
               {geom_sql}
               properties_json, source
        FROM hazard_events
        WHERE hazard_type = ?
    """
    params = [hazard_type]
    
    if severity:
        query += " AND severity = ?"
        params.append(severity)

    if year:
        query += " AND (EXTRACT(YEAR FROM start_time) = ? OR EXTRACT(YEAR FROM end_time) = ?)"
        params.extend([year, year])
        
    if date:
        query += " AND CAST(start_time AS DATE) <= TRY_CAST(? AS DATE) AND CAST(end_time AS DATE) >= TRY_CAST(? AS DATE)"
        params.extend([date, date])
        
    if bbox:
        try:
            coords = list(map(float, bbox.split(',')))
            if len(coords) != 4:
                raise ValueError()
            lon_min, lat_min, lon_max, lat_max = coords
            query += " AND ST_Intersects(geom, ST_MakeEnvelope(?, ?, ?, ?))"
            params.extend([lon_min, lat_min, lon_max, lat_max])
        except ValueError:
            from fastapi import HTTPException
            raise HTTPException(status_code=400, detail="Invalid bbox format. Expected lon_min,lat_min,lon_max,lat_max")
            
    result = db.execute(query, params).fetchdf()
    result = result.fillna('')
    for col in result.select_dtypes(include=['datetime64']).columns:
        result[col] = result[col].astype(str)
        
    records = result.to_dict(orient='records')
    
    for record in records:
        prop_str = record.get('properties_json')
        if prop_str and isinstance(prop_str, str):
            try:
                record['properties_json'] = json.loads(prop_str, parse_constant=lambda x: None)
            except json.JSONDecodeError:
                pass
                
        geom_str = record.get('geom_geojson')
        if geom_str and isinstance(geom_str, str):
            try:
                record['geom_geojson'] = json.loads(geom_str)
            except json.JSONDecodeError:
                pass
                
    return {
        "total_count": len(records),
        "data": records
    }
