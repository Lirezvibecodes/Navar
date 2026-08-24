import "dotenv/config";

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

/** A numeric env var, ignored rather than trusted when it is not a number. */
function numeric(name: string): number | undefined {
  const value = optional(name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    console.warn(`[config] ${name} is not a number; ignoring it.`);
    return undefined;
  }
  return parsed;
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
  /**
   * Overrides for the two media channels. Normally unset: the bot discovers
   * both from the updates they send it and remembers them in app_channels, so
   * these exist for pinning a channel by hand — pointing a local instance at a
   * scratch channel, say — rather than for ordinary deployment.
   */
  coverChannelId: numeric("COVER_CHANNEL_ID"),
  logChannelId: numeric("LOG_CHANNEL_ID"),
};

export { required };
