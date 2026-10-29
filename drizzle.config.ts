import { defineConfig } from 'drizzle-kit';

// npm run db:generate writes a migration to drizzle/ after src/server/db/schema.ts changes;
// the server applies drizzle/ at start (npm run db:migrate does the same by hand).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
