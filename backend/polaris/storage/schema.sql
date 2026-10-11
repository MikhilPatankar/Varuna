-- ============================================================
-- SEQUENCES
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS seq_profile_id START 1;
CREATE SEQUENCE IF NOT EXISTS seq_zone_id START 1;
CREATE SEQUENCE IF NOT EXISTS seq_hazard_id START 1;

-- ============================================================
-- INSTRUMENT REGISTRY (Argo floats, Gliders, CTDs, moorings)
-- ============================================================
CREATE TABLE IF NOT EXISTS instruments (
    instrument_id    VARCHAR PRIMARY KEY,   -- WMO ID e.g. "2901234"
    instrument_type  VARCHAR NOT NULL,      -- 'argo_float','glider','ctd','mooring'
    platform_name    VARCHAR,
    deploy_date      TIMESTAMP,
    last_report      TIMESTAMP,
    status           VARCHAR,               -- 'active','inactive','recovered'
    metadata_json    JSON,
    geom             GEOMETRY               -- POINT(lon, lat)
);
CREATE INDEX IF NOT EXISTS idx_instr_geom ON instruments USING RTREE (geom);

-- ============================================================
-- INSTRUMENT PROFILES (depth-resolved observations)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
    profile_id       BIGINT PRIMARY KEY,
    instrument_id    VARCHAR NOT NULL,
    observation_time TIMESTAMP NOT NULL,
    lat              DOUBLE NOT NULL,
    lon              DOUBLE NOT NULL,
    depth            DOUBLE NOT NULL,
    temperature      DOUBLE,
    salinity         DOUBLE,
    dissolved_oxygen DOUBLE,
    chlorophyll      DOUBLE,
    nitrate          DOUBLE,
    phosphate        DOUBLE,
    qc_flag          SMALLINT DEFAULT 0,
    geom             GEOMETRY
);
CREATE INDEX IF NOT EXISTS idx_prof_geom ON profiles USING RTREE (geom);
CREATE INDEX IF NOT EXISTS idx_prof_time ON profiles (observation_time);
CREATE INDEX IF NOT EXISTS idx_prof_instr ON profiles (instrument_id);

-- ============================================================
-- INSTRUMENT TRACKS (float/glider trajectory positions)
-- ============================================================
CREATE TABLE IF NOT EXISTS instrument_tracks (
    track_id         BIGINT PRIMARY KEY,
    instrument_id    VARCHAR NOT NULL,
    observation_time TIMESTAMP NOT NULL,
    lat              DOUBLE NOT NULL,
    lon              DOUBLE NOT NULL,
    depth            DOUBLE,
    speed            DOUBLE,
    heading          DOUBLE,
    geom             GEOMETRY
);
CREATE INDEX IF NOT EXISTS idx_track_geom ON instrument_tracks USING RTREE (geom);

-- ============================================================
-- TROPICAL CYCLONES (IBTrACS + JTWC + IMD)
-- ============================================================
CREATE TABLE IF NOT EXISTS cyclones (
    storm_id         VARCHAR NOT NULL,       -- IBTrACS SID
    basin            VARCHAR,
    name             VARCHAR,
    season           INTEGER,
    observation_time TIMESTAMP NOT NULL,
    lat              DOUBLE NOT NULL,
    lon              DOUBLE NOT NULL,
    max_wind_kts     DOUBLE,
    min_pressure_hpa DOUBLE,
    storm_category   VARCHAR,               -- 'TD','TS','C1'...'C5'
    storm_speed_kph  DOUBLE,
    storm_dir_deg    DOUBLE,
    wind_radii_json  JSON,
    is_current       BOOLEAN DEFAULT FALSE,
    source           VARCHAR,
    geom             GEOMETRY
);
CREATE INDEX IF NOT EXISTS idx_cyc_geom ON cyclones USING RTREE (geom);
CREATE INDEX IF NOT EXISTS idx_cyc_storm ON cyclones (storm_id);
CREATE INDEX IF NOT EXISTS idx_cyc_time ON cyclones (observation_time);

-- ============================================================
-- HAZARD EVENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS hazard_events (
    event_id         BIGINT PRIMARY KEY,
    hazard_type      VARCHAR NOT NULL,       -- 'marine_heatwave','coral_bleaching','dead_zone','harmful_algal_bloom','oil_spill','tsunami'
    name             VARCHAR,
    severity         VARCHAR,
    start_time       TIMESTAMP,
    end_time         TIMESTAMP,
    lat              DOUBLE,
    lon              DOUBLE,
    geom             GEOMETRY,               -- POLYGON or POINT
    properties_json  JSON,
    source           VARCHAR,
    source_url       VARCHAR
);
CREATE INDEX IF NOT EXISTS idx_haz_geom ON hazard_events USING RTREE (geom);
CREATE INDEX IF NOT EXISTS idx_haz_type ON hazard_events (hazard_type);

-- ============================================================
-- OCEAN ZONES (fishing spots, dead zones, MPAs)
-- ============================================================
CREATE TABLE IF NOT EXISTS ocean_zones (
    zone_id          BIGINT PRIMARY KEY,
    zone_type        VARCHAR NOT NULL,       -- 'fishing_spot','dead_zone','anomaly_region','marine_protected_area'
    name             VARCHAR,
    description      TEXT,
    valid_from       TIMESTAMP,
    valid_until      TIMESTAMP,
    geom             GEOMETRY,               -- POLYGON
    properties_json  JSON,
    source           VARCHAR
);
CREATE INDEX IF NOT EXISTS idx_zone_geom ON ocean_zones USING RTREE (geom);

-- ============================================================
-- DATASET CATALOG (registry of all ingested data)
-- ============================================================
CREATE TABLE IF NOT EXISTS dataset_catalog (
    dataset_id       VARCHAR PRIMARY KEY,
    dataset_name     VARCHAR NOT NULL,
    category         VARCHAR NOT NULL,       -- 'gridded','profile','track','zone'
    variables        JSON,
    temporal_type    VARCHAR,                -- 'yearly','monthly','daily'
    time_key         VARCHAR,                -- '2026','2026-09','2026-09-20'
    time_start       TIMESTAMP,
    time_end         TIMESTAMP,
    lat_min          DOUBLE,
    lat_max          DOUBLE,
    lon_min          DOUBLE,
    lon_max          DOUBLE,
    depth_min        DOUBLE,
    depth_max        DOUBLE,
    storage_path     VARCHAR,
    source_format    VARCHAR,
    chunk_shape      JSON,                   -- {"lon":64,"lat":64,"depth":10}
    file_size_bytes  BIGINT,
    ingested_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata_json    JSON
);
