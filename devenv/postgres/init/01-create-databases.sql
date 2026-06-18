-- Initialize databases for development and testing
CREATE DATABASE hermes_dev;
CREATE DATABASE hermes_test;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE hermes_dev TO hermes;
GRANT ALL PRIVILEGES ON DATABASE hermes_test TO hermes;

-- Connect to hermes_dev and create extensions
\c hermes_dev;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Connect to hermes_test and create extensions
\c hermes_test;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
