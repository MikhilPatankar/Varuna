from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import duckdb

from polaris.api.routes import data, instruments, cyclones, hazards, zones, datasets
from polaris.config import DUCKDB_PATH

from polaris.logger import logger

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("PRE-LOADING ZARR DATASETS INTO RAM CACHE...")
    try:
        con = duckdb.connect(str(DUCKDB_PATH))
        records = con.execute("SELECT dataset_name, temporal_type, time_key FROM dataset_catalog").fetchall()
        con.close()
        data.preload_datasets(records)
        logger.info(f"SUCCESSFULLY CACHED {len(records)} DATASETS.")
    except Exception as e:
        logger.error(f"Failed to preload datasets: {e}")
    yield
    logger.info("SHUTTING DOWN POLARIS API...")

app = FastAPI(
    title="POLARIS API",
    description="3D Ocean Data Visualization Platform API",
    version="0.1.0",
    lifespan=lifespan
)

# CORS middleware for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Update for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"], # To allow reading custom X- headers for binary data
)

app.include_router(data.router)
app.include_router(instruments.router)
app.include_router(cyclones.router)
app.include_router(hazards.router)
app.include_router(zones.router)
app.include_router(datasets.router)

from fastapi.staticfiles import StaticFiles
from polaris.config import DATA_DIR

static_dir = DATA_DIR / "static"
static_dir.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

@app.get("/health")
async def health_check():
    return {"status": "ok"}
