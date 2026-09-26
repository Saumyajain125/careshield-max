// The e2e suite talks to the real Postgres started by docker-compose.
process.env.DATABASE_URL ??=
  'postgresql://careshield:careshield@localhost:5433/careshield?schema=public';
process.env.NODE_ENV = 'test';
