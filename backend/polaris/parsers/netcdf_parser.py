import xarray as xr
import pandas as pd
import numpy as np
from typing import List
from polaris.parsers.base import BaseParser, ParseResult, DataCategory

class NetCDFParser(BaseParser):
    """Handles CMEMS GLORYS12V1, BGC products, HYCOM, ROMS outputs."""

    # CF-Convention variable name -> canonical name
    VARIABLE_ALIASES = {
        # Temperature
        "thetao": "temperature",
        "water_temp": "temperature",
        "temp": "temperature",
        "sea_water_potential_temperature": "temperature",
        # Salinity
        "so": "salinity",
        "salinity": "salinity",
        "salt": "salinity",
        "sea_water_salinity": "salinity",
        # Currents
        "uo": "u_current",
        "vo": "v_current",
        "water_u": "u_current",
        "water_v": "v_current",
        "u": "u_current",
        "v": "v_current",
        # SSH
        "zos": "ssh",
        "surf_el": "ssh",
        "zeta": "ssh",
        # Biogeochemistry
        "chl": "chlorophyll",
        "o2": "dissolved_oxygen",
        "no3": "nitrate",
        "po4": "phosphate",
        "si": "silicate",
        # Bathymetry
        "deptho": "bathymetry",
        "mask": "ocean_mask",
    }

    DIMENSION_ALIASES = {
        # lat
        "latitude": "lat", "y": "lat", "eta_rho": "lat", "nlat": "lat",
        # lon
        "longitude": "lon", "x": "lon", "xi_rho": "lon", "nlon": "lon",
        # depth
        "depth": "depth", "lev": "depth", "z": "depth", "s_rho": "depth", "deptht": "depth",
        # time
        "time": "time", "ocean_time": "time", "time_counter": "time",
    }

    def can_parse(self, filepath: str) -> bool:
        return any(filepath.endswith(ext) for ext in self.supported_extensions())

    def supported_extensions(self) -> List[str]:
        return ['.nc', '.nc4', '.hdf5', '.h5']

    def parse(self, filepath: str, **kwargs) -> ParseResult:
        ds = xr.open_dataset(filepath, engine='netcdf4', chunks='auto')

        # 1. Normalize dimensions
        dim_map = {}
        for dim in ds.dims:
            canonical = self.DIMENSION_ALIASES.get(dim.lower())
            if canonical and dim != canonical:
                dim_map[dim] = canonical
        if dim_map:
            ds = ds.rename(dim_map)

        # 2. Normalize variable names
        var_map = {}
        for var in list(ds.data_vars):
            canonical = self.VARIABLE_ALIASES.get(var.lower())
            if canonical and var != canonical:
                var_map[var] = canonical
        if var_map:
            ds = ds.rename(var_map)

        # 3. Handle ROMS sigma to z-level conversion
        if self._is_roms(ds):
            ds = self._convert_sigma_to_z(ds)

        # 4. Ensure consistent coordinate ordering
        if 'lat' in ds.coords and ds.lat.values[0] > ds.lat.values[-1]:
            ds = ds.isel(lat=slice(None, None, -1))

        time_range = None
        if 'time' in ds.dims:
            time_range = (pd.Timestamp(ds.time.values[0]), pd.Timestamp(ds.time.values[-1]))

        spatial_bounds = None
        if 'lat' in ds.coords and 'lon' in ds.coords:
            spatial_bounds = {
                'lat_min': float(np.nanmin(ds.lat.values)),
                'lat_max': float(np.nanmax(ds.lat.values)),
                'lon_min': float(np.nanmin(ds.lon.values)),
                'lon_max': float(np.nanmax(ds.lon.values)),
            }
            if 'depth' in ds.coords:
                spatial_bounds['depth_min'] = float(np.nanmin(ds.depth.values))
                spatial_bounds['depth_max'] = float(np.nanmax(ds.depth.values))

        return ParseResult(
            category=DataCategory.GRIDDED_FIELD,
            gridded=ds,
            metadata=dict(ds.attrs),
            variables=[v for v in ds.data_vars if v in self.VARIABLE_ALIASES.values()],
            time_range=time_range,
            spatial_bounds=spatial_bounds,
        )

    def _is_roms(self, ds: xr.Dataset) -> bool:
        return 'Cs_r' in ds or 's_rho' in ds.dims

    def _convert_sigma_to_z(self, ds: xr.Dataset) -> xr.Dataset:
        """Convert ROMS terrain-following coordinates to fixed z-levels."""
        import numpy as np
        standard_depths = np.array([
            0, 5, 10, 15, 20, 25, 30, 40, 50, 75,
            100, 125, 150, 200, 250, 300, 400, 500, 600, 700,
            800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1750, 2000,
            2500, 3000, 3500, 4000, 4500, 5000
        ])
        ds = ds.rename({'s_rho': 'depth'})
        ds = ds.assign_coords(depth=standard_depths[:len(ds.depth)])
        return ds
