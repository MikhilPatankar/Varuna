from enum import Enum
from typing import Optional, List
from dataclasses import dataclass, field
from abc import ABC, abstractmethod
import xarray as xr
import pandas as pd

class DataCategory(Enum):
    GRIDDED_FIELD = "gridded"      # 3D/4D temp, salinity, current grids
    POINT_PROFILE = "profile"      # Argo/Glider depth profiles
    TRACK_EVENT   = "track"        # Cyclone tracks, ship routes
    ZONE_POLYGON  = "zone"         # Dead zones, fishing areas, MPAs
    HAZARD_EVENT  = "hazard"       # Point-in-time incidents (Oil spills, algal blooms)

@dataclass
class ParseResult:
    category: DataCategory
    gridded: Optional[xr.Dataset] = None
    tabular: Optional[pd.DataFrame] = None
    metadata: dict = field(default_factory=dict)
    variables: list[str] = field(default_factory=list)
    time_range: Optional[tuple] = None
    spatial_bounds: Optional[dict] = None

class BaseParser(ABC):
    @abstractmethod
    def can_parse(self, filepath: str) -> bool:
        """Return True if this parser handles the given file."""
        pass

    @abstractmethod
    def parse(self, filepath: str, **kwargs) -> ParseResult:
        """Parse file and return normalized ParseResult."""
        pass

    @abstractmethod
    def supported_extensions(self) -> List[str]:
        """Return list of file extensions this parser handles."""
        pass
