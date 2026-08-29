// Lot E — connexion Redis partagée par toutes les files BullMQ de money-api.
// maxRetriesPerRequest: null : exigence BullMQ (les workers gèrent leur propre
// stratégie de reconnexion). lazyConnect: true : le smoke test DI
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
