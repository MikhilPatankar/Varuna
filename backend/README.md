# POLARIS Backend

This is the backend for the POLARIS 3D Ocean Data Visualization Platform. 
It serves volumetric ocean data from Copernicus Marine (CMEMS), Argo float profiles, and IBTrACS cyclone data.

## Setup

1. Make sure you are in the `backend` directory.
2. Install the dependencies:
   ```bash
   pip install -e .
   ```
3. Run the development server:
   ```bash
   uvicorn polaris.api.main:app --host 0.0.0.0 --port 8000 --reload
   ```

## Architecture

- **Zarr**: Chunked multidimensional arrays for fast web delivery of numeric volume data.
- **DuckDB**: Fast spatial SQL queries for points, cyclones, and zones.
- **FastAPI**: Provides binary `application/octet-stream` responses for WebGL rendering.
