import duckdb
import json
from pathlib import Path
from datetime import datetime
from polaris.config import DUCKDB_PATH, ZARR_ROOT, CHUNK_CONFIG
from polaris.parsers.registry import ParserRegistry
from polaris.parsers.netcdf_parser import NetCDFParser
from polaris.parsers.csv_parser import CSVParser
from polaris.parsers.argo_parser import ArgoParser
from polaris.parsers.shapefile_parser import ShapefileParser
from polaris.parsers.ibtracs_parser import IBTrACSParser
from polaris.parsers.incident_parser import IncidentParser
from polaris.parsers.insitu_parser import InSituParser
from polaris.parsers.base import DataCategory, ParseResult
from polaris.storage.zarr_store import ZarrStore

class IngestionPipeline:
    def __init__(self):
        self.registry = ParserRegistry()
        # Specific parsers first
        self.registry.register(IBTrACSParser())
        self.registry.register(IncidentParser())
        self.registry.register(InSituParser())
        self.registry.register(ArgoParser())
        # Generic parsers last
        self.registry.register(NetCDFParser())
        self.registry.register(CSVParser())
        self.registry.register(ShapefileParser())

        self.db_path = str(DUCKDB_PATH)
        self.zarr_store = ZarrStore(ZARR_ROOT)

    def _get_db(self):
        # Create a new connection per thread/task
        con = duckdb.connect(self.db_path)
        con.execute("LOAD spatial;")
        return con

    def ingest(self, filepath: str, tier: str = 'daily', time_key: str = None, **kwargs) -> str:
        """
        Ingest a file into the appropriate storage.
        Returns dataset_id or batch type.
        """
        result = self.registry.parse(filepath, **kwargs)
        if result.tabular is None and result.gridded is None:
            return "empty_result"

        if result.category == DataCategory.GRIDDED_FIELD:
            return self._ingest_gridded(result, tier, time_key)
        elif result.category == DataCategory.POINT_PROFILE:
            return self._ingest_profiles(result)
        elif result.category == DataCategory.TRACK_EVENT:
            return self._ingest_tracks(result)
        elif result.category == DataCategory.ZONE_POLYGON:
            return self._ingest_zones(result)
        elif result.category == DataCategory.HAZARD_EVENT:
            return self._ingest_hazards(result)

    def _ingest_gridded(self, result: ParseResult, tier: str, time_key: str):
        ds = result.gridded
        
        for var in result.variables:
            # Write to Zarr
            store_path = self.zarr_store.write(ds, var, tier, time_key)
            
            # Register in catalog
            self._register_catalog(var, tier, time_key, store_path, result)
            
        return f"{tier}/{time_key}"

    def _ingest_profiles(self, result: ParseResult):
        df = result.tabular
        con = self._get_db()
        if 'lat' in df.columns and 'lon' in df.columns:
            # Ensure instrument exists
            if 'instrument_id' in df.columns:
                instrument_type_expr = "instrument_type" if 'instrument_type' in df.columns else "'argo_float'"
                con.execute(f"""
                    INSERT INTO instruments (instrument_id, instrument_type)
                    SELECT DISTINCT CAST(instrument_id AS VARCHAR), {instrument_type_expr}
                    FROM df
                    WHERE CAST(instrument_id AS VARCHAR) NOT IN (SELECT instrument_id FROM instruments)
                """)

            # Add missing columns with NULL to prevent DuckDB Binder Errors
            for col in ['temperature', 'salinity', 'dissolved_oxygen', 'chlorophyll']:
                if col not in df.columns:
                    df[col] = None
                    
            if 'depth' not in df.columns:
                df['depth'] = 0.0

            # Insert profiles
            con.execute("CREATE SEQUENCE IF NOT EXISTS seq_profile_id START 1;")
            con.execute("""
                INSERT INTO profiles (profile_id, instrument_id, observation_time,
                    lat, lon, depth, temperature, salinity,
                    dissolved_oxygen, chlorophyll, geom)
                SELECT 
                    nextval('seq_profile_id') as profile_id,
                    CAST(COALESCE(instrument_id, 'unknown') AS VARCHAR),
                    observation_time,
                    lat, lon, 
                    TRY_CAST(depth AS DOUBLE), 
                    TRY_CAST(temperature AS DOUBLE), 
                    TRY_CAST(salinity AS DOUBLE),
                    TRY_CAST(dissolved_oxygen AS DOUBLE), 
                    TRY_CAST(chlorophyll AS DOUBLE),
                    ST_Point(lon, lat)
                FROM df
            """)
        con.close()
        return "profiles_batch"

    def _ingest_tracks(self, result: ParseResult):
        df = result.tabular
        con = self._get_db()
        con.execute("""
            INSERT INTO cyclones (storm_id, name, basin, season,
                observation_time, lat, lon, max_wind_kts, min_pressure_hpa,
                storm_category, storm_speed_kph, storm_dir_deg, source, geom)
            SELECT 
                storm_id, name, basin, season,
                observation_time, lat, lon, 
                TRY_CAST(max_wind_kts AS DOUBLE), 
                TRY_CAST(min_pressure_hpa AS DOUBLE),
                storm_category, 
                TRY_CAST(storm_speed_kph AS DOUBLE), 
                TRY_CAST(storm_dir_deg AS DOUBLE),
                'ibtracs' as source, ST_Point(lon, lat)
            FROM df
        """)
        con.close()
        return "cyclones_batch"

    def _ingest_zones(self, result: ParseResult):
        df = result.tabular
        con = self._get_db()
        con.execute("CREATE SEQUENCE IF NOT EXISTS seq_zone_id START 1;")
        con.execute("""
            INSERT INTO ocean_zones (zone_id, zone_type, name, geom)
            SELECT 
                nextval('seq_zone_id'),
                'fishing_spot',
                name,
                ST_GeomFromText(geom_wkt)
            FROM df
        """)
        con.close()
        return "zones_batch"

    def _ingest_hazards(self, result: ParseResult):
        df = result.tabular
        con = self._get_db()
        con.execute("CREATE SEQUENCE IF NOT EXISTS seq_hazard_id START 1;")
        con.execute("""
            INSERT INTO hazard_events (event_id, hazard_type, name, severity,
                start_time, end_time, lat, lon, geom, properties_json, source)
            SELECT 
                nextval('seq_hazard_id'),
                hazard_type,
                name,
                severity,
                start_time,
                end_time,
                TRY_CAST(lat AS DOUBLE),
                TRY_CAST(lon AS DOUBLE),
                ST_Point(lon, lat),
                properties_json,
                source
            FROM df
        """)
        con.close()
        return "hazards_batch"

    def _register_catalog(self, var: str, tier: str, time_key: str, store_path: str, result: ParseResult):
        dataset_id = f"{var}_{tier}_{time_key}"
        con = self._get_db()
        
        time_start = result.time_range[0] if result.time_range else None
        time_end = result.time_range[1] if result.time_range else None
        
        con.execute("""
            INSERT OR REPLACE INTO dataset_catalog
            (dataset_id, dataset_name, category, variables, temporal_type,
             time_key, time_start, time_end, lat_min, lat_max, lon_min, lon_max,
             depth_min, depth_max, storage_path, chunk_shape)
            VALUES (?, ?, 'gridded', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            dataset_id, var, json.dumps([var]), tier, time_key,
            time_start, time_end,
            result.spatial_bounds.get('lat_min') if result.spatial_bounds else None,
            result.spatial_bounds.get('lat_max') if result.spatial_bounds else None,
            result.spatial_bounds.get('lon_min') if result.spatial_bounds else None,
            result.spatial_bounds.get('lon_max') if result.spatial_bounds else None,
            result.spatial_bounds.get('depth_min') if result.spatial_bounds else None,
            result.spatial_bounds.get('depth_max') if result.spatial_bounds else None,
            store_path, json.dumps(CHUNK_CONFIG),
        ])
        con.close()
