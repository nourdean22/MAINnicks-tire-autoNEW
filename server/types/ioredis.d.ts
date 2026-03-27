declare module "ioredis" {
  interface RedisOptions {
    maxRetriesPerRequest?: number;
    lazyConnect?: boolean;
    retryStrategy?: (times: number) => number | null;
  }

  class Redis {
    constructor(url: string, options?: RedisOptions);
    on(event: string, cb: (...args: any[]) => void): this;
    connect(): Promise<void>;
    get(key: string): Promise<string | null>;
    setex(key: string, ttl: number, value: string): Promise<void>;
    del(key: string): Promise<void>;
    keys(pattern: string): Promise<string[]>;
    disconnect(): void;
  }

  export default Redis;
}
