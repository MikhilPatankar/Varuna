FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    libgdal-dev \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY pyproject.toml .
RUN pip install hatchling
RUN pip install .

# Copy source code
COPY . .

# Expose API port
EXPOSE 8000

# Run FastAPI server
CMD ["uvicorn", "polaris.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
