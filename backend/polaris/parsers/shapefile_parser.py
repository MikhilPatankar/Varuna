import geopandas as gpd
from typing import List
from polaris.parsers.base import BaseParser, ParseResult, DataCategory

class ShapefileParser(BaseParser):
    def can_parse(self, filepath: str) -> bool:
        return any(filepath.endswith(ext) for ext in self.supported_extensions())

    def supported_extensions(self) -> List[str]:
        return ['.shp', '.geojson', '.gpkg']

    def parse(self, filepath: str, **kwargs) -> ParseResult:
        gdf = gpd.read_file(filepath)
        
        # Convert to EPSG:4326 (WGS84) if not already
        if gdf.crs and gdf.crs.to_epsg() != 4326:
            gdf = gdf.to_crs(epsg=4326)

        # Basic bounding box
        bounds = gdf.total_bounds
        spatial_bounds = {
            'lon_min': float(bounds[0]),
            'lat_min': float(bounds[1]),
            'lon_max': float(bounds[2]),
            'lat_max': float(bounds[3]),
        }

        # Convert geometry to WKT for DuckDB insertion
        gdf['geom_wkt'] = gdf.geometry.apply(lambda geom: geom.wkt)
        
        category_hint = kwargs.get('category_hint', DataCategory.ZONE_POLYGON)

        return ParseResult(
            category=category_hint,
            tabular=gdf.drop(columns=['geometry']), # DuckDB will use geom_wkt
            variables=list(gdf.columns),
            spatial_bounds=spatial_bounds
        )
