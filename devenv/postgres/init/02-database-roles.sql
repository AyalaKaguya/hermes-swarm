-- Development-only database principals. Application tables are created only by
-- TypeORM migrations; keeping schema DDL out of docker-entrypoint-initdb.d
-- prevents the retired Organization-as-Tenant model from reappearing.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hermes_tenant_app') THEN
    CREATE ROLE hermes_tenant_app
      LOGIN PASSWORD 'hermes_tenant_dev_pwd'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE hermes_tenant_app
      LOGIN PASSWORD 'hermes_tenant_dev_pwd'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE hermes TO hermes_tenant_app;
GRANT CONNECT ON DATABASE hermes_dev TO hermes_tenant_app;
GRANT CONNECT ON DATABASE hermes_test TO hermes_tenant_app;
GRANT CONNECT ON DATABASE "hermes-e2e" TO hermes_tenant_app;
