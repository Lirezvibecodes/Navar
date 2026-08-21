import "dotenv/config";

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function required(name: string): string {
  const value = optional(name);
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(optional("PORT") ?? 3000),
  botToken: optional("BOT_TOKEN"),
  miniAppUrl: optional("MINI_APP_URL"),
  webhookUrl: optional("WEBHOOK_URL"),
  databaseUrl: optional("DATABASE_URL"),
  jwtSecret: optional("JWT_SECRET"),
};

export { required };
