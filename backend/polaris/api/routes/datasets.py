from fastapi import APIRouter, Depends
import duckdb
import json
from polaris.api.deps import get_db

router = APIRouter(prefix="/api/v1", tags=["Datasets"])

@router.get("/datasets")
async def list_datasets(db: duckdb.DuckDBPyConnection = Depends(get_db)):
    query = """
        SELECT dataset_id, dataset_name, category, variables, temporal_type,
               time_key, time_start, time_end,
               lat_min, lat_max, lon_min, lon_max,
               depth_min, depth_max
        FROM dataset_catalog
    """
    result = db.execute(query).fetchdf()
    result = result.fillna('')
    for col in result.select_dtypes(include=['datetime64']).columns:
        result[col] = result[col].astype(str)
        
    data = result.to_dict(orient='records')
    return {
        "total_count": len(data),
        "data": data
    }

@router.get("/variables")
async def list_variables(db: duckdb.DuckDBPyConnection = Depends(get_db)):
    query = """
        SELECT DISTINCT dataset_name as variable_name, category
        FROM dataset_catalog
    """
    result = db.execute(query).fetchdf()
    data = result.to_dict(orient='records')
    return {
        "total_count": len(data),
        "data": data
    }

@router.get("/timeline/{variable}")
async def get_timeline(variable: str, db: duckdb.DuckDBPyConnection = Depends(get_db)):
    query = """
        SELECT temporal_type, time_key
        FROM dataset_catalog
        WHERE dataset_name = ?
        ORDER BY time_key DESC
    """
    result = db.execute(query, [variable]).fetchdf()
    
    timeline = {}
    for _, row in result.iterrows():
        tier = row['temporal_type']
        if tier not in timeline:
            timeline[tier] = []
        timeline[tier].append(row['time_key'])
        
    return timeline
