// Lot J3 — connexion Redis partagée par les files BullMQ de trust-api (copie du
// pattern money-api, Lot E). maxRetriesPerRequest: null : exigence BullMQ (les
// workers gèrent leur propre reconnexion). lazyConnect: true : le smoke test DI
// (app.module.spec) compile l'AppModule sans qu'un Redis tourne — la connexion
// réelle n'a lieu qu'au premier usage d'une Queue/Worker.
export interface RedisConnectionOptions {
  url: string;
  maxRetriesPerRequest: null;
  lazyConnect: true;
}

export function buildRedisConnection(): RedisConnectionOptions {
  return {
    url: process.env.REDIS_URL ?? "redis://localhost:6379",
    maxRetriesPerRequest: null,
    lazyConnect: true,
  };
}
