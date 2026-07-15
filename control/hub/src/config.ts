import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  hubAccessToken: process.env.HUB_ACCESS_TOKEN || 'herdr-hub-dev-token',
  databaseUrl: process.env.DATABASE_URL || 'postgres://herdr:herdr@localhost:5432/herdr_hub',
  corsOrigins: (process.env.CORS_ORIGINS || '*').split(','),
};
