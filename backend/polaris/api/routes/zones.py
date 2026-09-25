from fastapi import APIRouter, Query, Depends
import duckdb
from polaris.api.deps import get_db

router = APIRouter(prefix="/api/v1", tags=["Zones"])

@router.get("/zones")
async def get_zones(
    zone_type: str = Query(None),
    bbox: str = Query(None),
    db: duckdb.DuckDBPyConnection = Depends(get_db)
):
    query = """
        SELECT zone_id, zone_type, name, description,
               valid_from, valid_until,
               properties_json, source,
               ST_AsGeoJSON(geom) as geometry
        FROM ocean_zones
        WHERE 1=1
    """
    params = []
    
    if zone_type:
        query += " AND zone_type = ?"
        params.append(zone_type)
        
    if bbox:
        lon_min, lat_min, lon_max, lat_max = map(float, bbox.split(','))
        query += " AND ST_Intersects(geom, ST_MakeEnvelope(?, ?, ?, ?))"
        params.extend([lon_min, lat_min, lon_max, lat_max])
        
    result = db.execute(query, params).fetchdf()
    result = result.fillna('')
    for col in result.select_dtypes(include=['datetime64']).columns:
        result[col] = result[col].astype(str)
        
    return result.to_dict(orient='records')
