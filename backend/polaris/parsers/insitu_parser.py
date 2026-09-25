import xarray as xr
import pandas as pd
from typing import List, Any
from polaris.parsers.base import BaseParser, ParseResult, DataCategory

class InSituParser(BaseParser):
    """
    Parser for Copernicus Marine In-Situ Observations (NetCDF format).
    Product ID: INSITU_GLO_PHYBGCWAV_DISCRETE_MYNRT_013_030
    Handles diverse instruments: Argo, CTD, Glider, Drifter, Mooring, etc.
    """

    def can_parse(self, source: Any, **kwargs) -> bool:
        if isinstance(source, str) and source.endswith(".nc"):
            if "insitu" in source.lower() or "obs-ins" in source.lower() or "gl_ts" in source.lower():
                return True
        return False

    def supported_extensions(self) -> List[str]:
        return ['.nc']

    def parse(self, source: Any, **kwargs) -> ParseResult:
        ds = xr.open_dataset(source)
        df = ds.to_dataframe().reset_index()

        # Map Copernicus In-Situ variables to Polaris schema
        rename_map = {
            'LATITUDE': 'lat', 'LONGITUDE': 'lon',
            'DEPH': 'depth', 'PRES': 'depth',
            'TEMP': 'temperature', 'PSAL': 'salinity',
            'DOX1': 'dissolved_oxygen', 'DOXY': 'dissolved_oxygen',
            'CPHL': 'chlorophyll', 'CHLA': 'chlorophyll',
            'NTAW': 'nitrate', 'NTRA': 'nitrate',
            'PHOW': 'phosphate', 'PHOS': 'phosphate',
            'TIME': 'observation_time',
            'PLATFORM_CODE': 'instrument_id', 'WMO_INST_TYPE': 'instrument_type',
            'DATA_MODE': 'qc_flag',
        }
        
        df = df.rename(columns={k: v for k, v in rename_map.items() if k in df.columns})

        # Set default values if missing
        if 'instrument_id' not in df.columns:
            df['instrument_id'] = 'unknown_platform'
        else:
            # NetCDF string arrays sometimes come as bytes
            if df['instrument_id'].dtype == object:
                df['instrument_id'] = df['instrument_id'].apply(lambda x: x.decode('utf-8').strip() if isinstance(x, bytes) else str(x).strip())
                
        # Drop rows missing crucial spatial/temporal data
        if 'lat' in df.columns and 'lon' in df.columns and 'observation_time' in df.columns:
            df = df.dropna(subset=['lat', 'lon', 'observation_time'])

        time_range = None
        if 'observation_time' in df.columns and not df.empty:
            time_range = (df['observation_time'].min(), df['observation_time'].max())

        spatial_bounds = None
        if 'lat' in df.columns and 'lon' in df.columns and not df.empty:
            spatial_bounds = {
                'lat_min': float(df['lat'].min()),
                'lat_max': float(df['lat'].max()),
                'lon_min': float(df['lon'].min()),
                'lon_max': float(df['lon'].max()),
            }

        return ParseResult(
            category=DataCategory.POINT_PROFILE,
            tabular=df,
            variables=['temperature', 'salinity', 'dissolved_oxygen', 'chlorophyll'],
            time_range=time_range,
            spatial_bounds=spatial_bounds,
            metadata={"source": "Copernicus In-Situ"}
        )
