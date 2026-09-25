from apscheduler.schedulers.asyncio import AsyncIOScheduler
import asyncio
from datetime import datetime
import sys
from pathlib import Path

backend_dir = Path(__file__).parent.parent.resolve()
sys.path.insert(0, str(backend_dir))

from polaris.pipeline.ingestion import IngestionPipeline

scheduler = AsyncIOScheduler()
pipeline = IngestionPipeline()

@scheduler.scheduled_job('cron', hour=3, minute=0)
async def daily_argo_pull():
    """Pull latest Argo profiles for Indian Ocean."""
    print(f"[{datetime.utcnow()}] Running daily Argo pull...")
    try:
        pipeline.ingest("argo://region")
        print("Argo pull successful.")
    except Exception as e:
        print(f"Error during Argo pull: {e}")

@scheduler.scheduled_job('cron', hour=2, minute=0)
async def daily_cmems_pull():
    """Pull latest CMEMS data (Placeholder)."""
    print(f"[{datetime.utcnow()}] Running daily CMEMS pull...")
    # Add copernicusmarine download logic here

def start_scheduler():
    print("Starting POLARIS scheduler...")
    scheduler.start()
    try:
        asyncio.get_event_loop().run_forever()
    except (KeyboardInterrupt, SystemExit):
        pass

if __name__ == "__main__":
    start_scheduler()
