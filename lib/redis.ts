import { getCommonEnv } from "./env";

export function redisConnection() {
  const url = new URL(getCommonEnv().upstashRedisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: decodeURIComponent(url.username || "default"),
    password: decodeURIComponent(url.password),
    tls: {},
  };
}
