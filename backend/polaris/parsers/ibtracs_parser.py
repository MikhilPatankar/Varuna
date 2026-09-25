import pandas as pd
import numpy as np
from typing import Any
from datetime import datetime
from polaris.parsers.base import BaseParser, ParseResult, DataCategory

class IBTrACSParser(BaseParser):
    """
    Parser for NOAA IBTrACS tropical cyclone CSV datasets.
    Maps NOAA's extensive column format to the Polaris 'cyclones' schema.
    """

    def can_parse(self, source: Any, **kwargs) -> bool:
        if isinstance(source, str) and source.endswith(".csv"):
            if "ibtracs" in source.lower():
                return True
        return False

    def supported_extensions(self) -> list[str]:
        return [".csv"]

    def parse(self, source: Any, **kwargs) -> ParseResult:
        # IBTrACS v4 CSV has a secondary header row (units) at index 1 that breaks pandas
        # We read the first row as header, then skip the second row.
        df = pd.read_csv(source, header=0, skiprows=[1], low_memory=False)

        # Standardize empty/missing values. IBTrACS uses various empty representations.
        df = df.replace(' ', np.nan)

        # Map IBTrACS columns to Polaris schema
        mapped_df = pd.DataFrame()
        
        # Core identification
        mapped_df['storm_id'] = df['SID']
        mapped_df['name'] = df['NAME'].fillna('UNNAMED')
        mapped_df['basin'] = df['BASIN'].fillna('UNKNOWN')
        mapped_df['season'] = pd.to_numeric(df['SEASON'], errors='coerce').fillna(0).astype(int)
        
        # Spatial-Temporal
        mapped_df['observation_time'] = pd.to_datetime(df['ISO_TIME'], errors='coerce')
        mapped_df['lat'] = pd.to_numeric(df['LAT'], errors='coerce')
        mapped_df['lon'] = pd.to_numeric(df['LON'], errors='coerce')
        
        # Meteorology (Use USA agency data as primary, WMO as fallback)
        # IBTrACS provides data from multiple agencies. USA_WIND is usually complete globally.
        mapped_df['max_wind_kts'] = pd.to_numeric(df.get('USA_WIND', df.get('WMO_WIND')), errors='coerce')
        mapped_df['min_pressure_hpa'] = pd.to_numeric(df.get('USA_PRES', df.get('WMO_PRES')), errors='coerce')
        
        # Derived/Optional
        mapped_df['storm_category'] = df.get('USA_SSHS', np.nan).fillna(-1) # Saffir-Simpson Scale
        mapped_df['storm_speed_kph'] = pd.to_numeric(df.get('STORM_SPEED'), errors='coerce') * 1.852 # Convert knots to kph
        mapped_df['storm_dir_deg'] = pd.to_numeric(df.get('STORM_DIR'), errors='coerce')
        
        # Drop rows with critical missing spatial data
        mapped_df = mapped_df.dropna(subset=['lat', 'lon', 'observation_time'])

        # Create ParseResult
        time_range = (
            mapped_df['observation_time'].min().isoformat(),
            mapped_df['observation_time'].max().isoformat()
        )
        spatial_bounds = {
            'lat_min': mapped_df['lat'].min(),
            'lat_max': mapped_df['lat'].max(),
            'lon_min': mapped_df['lon'].min(),
            'lon_max': mapped_df['lon'].max()
        }

        return ParseResult(
            category=DataCategory.TRACK_EVENT,
            tabular=mapped_df,
            time_range=time_range,
            spatial_bounds=spatial_bounds,
            metadata={"source": "NOAA IBTrACS v4"}
        )
