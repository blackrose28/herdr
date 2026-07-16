import 'dotenv/config';

export const config = {
  host: process.env.HOST || '0.0.0.0',
  port: parseInt(process.env.PORT || '3850', 10),
  hubAccessToken: process.env.HUB_ACCESS_TOKEN || 'herdr-hub-dev-token',
  databaseUrl: process.env.DATABASE_URL || 'postgres://herdr:herdr@localhost:5432/herdr_hub',
  corsOrigins: (process.env.CORS_ORIGINS || '*').split(','),
};
