import pandas as pd
from typing import List
from polaris.parsers.base import BaseParser, ParseResult, DataCategory

class CSVParser(BaseParser):
    """Handles IBTrACS cyclone data, instrument logs, generic ocean CSVs."""

    FORMAT_SIGNATURES = {
        'ibtracs': {
            'columns': {'SID', 'ISO_TIME', 'LAT', 'LON', 'WMO_WIND', 'WMO_PRES'},
            'category': DataCategory.TRACK_EVENT,
            'column_map': {
                'SID': 'storm_id', 'NAME': 'name', 'SEASON': 'season',
                'BASIN': 'basin', 'ISO_TIME': 'observation_time',
                'LAT': 'lat', 'LON': 'lon',
                'WMO_WIND': 'max_wind_kts', 'WMO_PRES': 'min_pressure_hpa',
                'STORM_SPEED': 'storm_speed_kph', 'STORM_DIR': 'storm_dir_deg',
                'USA_SSHS': 'storm_category',
            },
        },
        'instrument_log': {
            'columns': {'lat', 'lon', 'depth', 'temperature'},
            'category': DataCategory.POINT_PROFILE,
            'column_map': {},
        },
    }

    def can_parse(self, filepath: str) -> bool:
        return any(filepath.endswith(ext) for ext in self.supported_extensions())

    def supported_extensions(self) -> List[str]:
        return ['.csv', '.tsv', '.txt', '.dat']

    def parse(self, filepath: str, **kwargs) -> ParseResult:
        # IBTrACS has a secondary header row, so we might need to handle it depending on the source.
        # Here we do a basic read.
        try:
            # Skip the second row in IBTrACS which contains units
            df = pd.read_csv(filepath, sep=None, engine='python', 
                             na_values=[' ', '', '-9999', '-9999.0'],
                             skiprows=lambda x: x == 1 if 'ibtracs' in filepath.lower() else False)
        except Exception:
            df = pd.read_csv(filepath, sep=None, engine='python', 
                             na_values=[' ', '', '-9999', '-9999.0'])

        fmt_key = kwargs.get('format_hint') or self._detect_format(df)
        fmt = self.FORMAT_SIGNATURES.get(fmt_key, {})

        if fmt.get('column_map'):
            df = df.rename(columns=fmt['column_map'])

        time_col = 'observation_time' if 'observation_time' in df.columns else None
        if time_col:
            df[time_col] = pd.to_datetime(df[time_col], errors='coerce')

        time_range = None
        if time_col and not df[time_col].empty:
            time_range = (df[time_col].min(), df[time_col].max())
            
        spatial_bounds = None
        if {'lat', 'lon'}.issubset(df.columns) and not df['lat'].empty and not df['lon'].empty:
            spatial_bounds = {
                'lat_min': float(df['lat'].min()),
                'lat_max': float(df['lat'].max()),
                'lon_min': float(df['lon'].min()),
                'lon_max': float(df['lon'].max()),
            }

        return ParseResult(
            category=fmt.get('category', DataCategory.POINT_PROFILE),
            tabular=df,
            variables=list(df.columns),
            time_range=time_range,
            spatial_bounds=spatial_bounds,
        )

    def _detect_format(self, df: pd.DataFrame) -> str:
        cols = set(df.columns)
        for name, sig in self.FORMAT_SIGNATURES.items():
            if sig['columns'].issubset(cols):
                return name
        return 'generic'
