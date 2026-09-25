import xarray as xr
from typing import List
from polaris.parsers.base import BaseParser, ParseResult, DataCategory

class ArgoParser(BaseParser):
    """Fetch and parse Argo float profiles from the GDAC."""

    def can_parse(self, filepath: str) -> bool:
        if filepath.startswith('argo://'):
            return True
        return 'argo' in filepath.lower() and filepath.endswith('.nc')

    def supported_extensions(self) -> List[str]:
        return ['.nc']

    def parse(self, filepath: str, **kwargs) -> ParseResult:
        if filepath.startswith('argo://'):
            # This requires argopy library to fetch real data
            import argopy
            loader = argopy.DataFetcher(src='gdac')
            # Default to Indian Ocean if no box provided
            box = kwargs.get('box', [30, 120, -40, 30, 0, 1000]) # lon_min, lon_max, lat_min, lat_max, pres_min, pres_max
            try:
                # argopy's region format is [lon_min, lon_max, lat_min, lat_max, pres_min, pres_max]
                ds = loader.region(box).to_xarray()
            except Exception as e:
                print(f"Error fetching Argo data: {e}")
                # Return empty result
                return ParseResult(category=DataCategory.POINT_PROFILE, tabular=None)
        else:
            ds = xr.open_dataset(filepath)

        df = ds.to_dataframe().reset_index()
        
        # Mapping common argopy columns
        rename_map = {
            'LATITUDE': 'lat', 'LONGITUDE': 'lon',
            'PRES': 'depth', 'TEMP': 'temperature',
            'PSAL': 'salinity', 'DOXY': 'dissolved_oxygen',
            'CHLA': 'chlorophyll',
            'TIME': 'observation_time',
            'JULD': 'observation_time',
            'PLATFORM_NUMBER': 'instrument_id',
        }
        
        df = df.rename(columns={k: v for k, v in rename_map.items() if k in df.columns})

        time_range = None
        if 'observation_time' in df.columns:
            time_range = (df['observation_time'].min(), df['observation_time'].max())

        spatial_bounds = None
        if 'lat' in df.columns and 'lon' in df.columns:
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
        )
