import argparse
import sys
from pathlib import Path

backend_dir = Path(__file__).parent.parent.resolve()
sys.path.insert(0, str(backend_dir))

from polaris.pipeline.ingestion import IngestionPipeline

def main():
    parser = argparse.ArgumentParser(description="Ingest ocean data into POLARIS.")
    parser.add_argument("filepath", help="Path to the file to ingest")
    parser.add_argument("--tier", default="daily", help="Temporal tier (daily/monthly/yearly)")
    parser.add_argument("--time-key", help="Time key (e.g., 2026-09-20)")
    
    args = parser.parse_args()
    
    pipeline = IngestionPipeline()
    print(f"Ingesting {args.filepath}...")
    result = pipeline.ingest(args.filepath, tier=args.tier, time_key=args.time_key)
    print(f"Ingestion complete. Result: {result}")

if __name__ == "__main__":
    main()
