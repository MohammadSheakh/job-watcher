/** Validate worker controls before scheduling network work. */
export function crawlConfig(): {
  delayMs: number;
  domainDelayMs: number;
  concurrency: number;
  limit: number | undefined;
} {
  const integer = (key: string, fallback: number, min: number, max: number): number => {
    const raw = process.env[key];
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw new Error(`${key} is outside the supported integer range.`);
    return value;
  };
  return {
    delayMs: integer('CRAWL_DELAY_MS', 0, 0, 60000),
    domainDelayMs: integer('CRAWL_DOMAIN_DELAY_MS', 500, 0, 10000),
    concurrency: integer('CRAWL_CONCURRENCY', 5, 1, 25),
    limit: process.env.CRAWL_LIMIT === undefined ? undefined : integer('CRAWL_LIMIT', 1, 1, 100000),
  };
}
