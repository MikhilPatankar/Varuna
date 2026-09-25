import pandas as pd
import numpy as np
import json
from typing import Any
from polaris.parsers.base import BaseParser, ParseResult, DataCategory

class IncidentParser(BaseParser):
    """
    Parser for hazard incidents (like Oil Spills) from NOAA IncidentNews or similar CSV databases.
    Maps to the Polaris 'hazard_events' schema.
    """

    def can_parse(self, source: Any, **kwargs) -> bool:
        if isinstance(source, str) and source.endswith(".csv"):
            if "incident" in source.lower() or "spill" in source.lower():
                return True
        return False

    def supported_extensions(self) -> list[str]:
        return [".csv"]

    def parse(self, source: Any, **kwargs) -> ParseResult:
        df = pd.read_csv(source, low_memory=False)
        
        # Standardize empty/missing values
        df = df.replace(' ', np.nan)
        
        mapped_df = pd.DataFrame()
        
        # Map generic incident columns
        mapped_df['name'] = df.get('name', df.get('incident_name', 'Unknown Incident'))
        mapped_df['hazard_type'] = df.get('threat', df.get('incident_type', 'oil_spill')).str.lower().fillna('oil_spill')
        mapped_df['severity'] = df.get('severity', 'unknown')
        
        # Spatial
        mapped_df['lat'] = pd.to_numeric(df.get('lat', df.get('latitude')), errors='coerce')
        mapped_df['lon'] = pd.to_numeric(df.get('lon', df.get('longitude')), errors='coerce')
        
        # Temporal
        mapped_df['start_time'] = pd.to_datetime(df.get('open_date', df.get('start_date')), errors='coerce')
        mapped_df['end_time'] = pd.to_datetime(df.get('close_date', df.get('end_date')), errors='coerce')
        
        # Extra properties packed into JSON
        properties_list = []
        for _, row in df.iterrows():
            props = {}
            if 'commodity' in row: props['commodity'] = row['commodity']
            if 'quantity' in row: props['quantity'] = row['quantity']
            if 'location' in row: props['location'] = row['location']
            properties_list.append(json.dumps(props) if props else None)
            
        mapped_df['properties_json'] = properties_list
        mapped_df['source'] = kwargs.get('source_name', 'NOAA IncidentNews')
        
        # Drop rows with critical missing spatial data
        mapped_df = mapped_df.dropna(subset=['lat', 'lon', 'start_time'])

        time_range = (
            mapped_df['start_time'].min().isoformat() if not mapped_df.empty else None,
            mapped_df['start_time'].max().isoformat() if not mapped_df.empty else None
        )
        spatial_bounds = {
            'lat_min': mapped_df['lat'].min(),
            'lat_max': mapped_df['lat'].max(),
            'lon_min': mapped_df['lon'].min(),
            'lon_max': mapped_df['lon'].max()
        } if not mapped_df.empty else {}

        return ParseResult(
            category=DataCategory.HAZARD_EVENT,
            tabular=mapped_df,
            time_range=time_range,
            spatial_bounds=spatial_bounds,
            metadata={"source": "Incident Database"}
        )
