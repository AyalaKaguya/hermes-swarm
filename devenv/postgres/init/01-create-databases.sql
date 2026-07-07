-- Initialize databases for development and testing
CREATE DATABASE hermes_dev;
CREATE DATABASE hermes_test;
CREATE DATABASE "hermes-e2e";

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE hermes_dev TO hermes;
GRANT ALL PRIVILEGES ON DATABASE hermes_test TO hermes;
GRANT ALL PRIVILEGES ON DATABASE "hermes-e2e" TO hermes;

-- Connect to the default application database and create extensions
\c hermes;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Connect to hermes_dev and create extensions
\c hermes_dev;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Connect to hermes_test and create extensions
\c hermes_test;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Connect to hermes-e2e and create extensions
\c "hermes-e2e";

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
