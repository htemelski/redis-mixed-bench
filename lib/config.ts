import * as yargs from 'yargs';

export interface BenchmarkArgs {
  host: string;
  port: number;
  a: string;
  user: string;
  'data-size': number;
  clients: number;
  'json-out-file': string;
  'client-update-tick': number;
  'test-time': number;
  'rand-seed': number;
  'oss-cluster-api-distribute-subscribers': boolean;
  'slot-refresh-interval': number;
  verbose: boolean;
  'measure-rtt-latency': boolean;
  'redis-timeout': number;
  'rate-limit': number;
}

export function parseArgs(): BenchmarkArgs {
  return yargs
    .option("host", { description: "Redis host", default: "127.0.0.1" })
    .option("port", { description: "Redis port", default: 6379 })
    .option("a", { description: "Password for Redis Auth", default: "" })
    .option("user", { description: "ACL-style AUTH username", default: "" })
    .option("data-size", { description: "Payload size in bytes", default: 300 })
    .option("clients", { description: "Number of connections", default: 1 })
    .option("json-out-file", { default: "" })
    .option("client-update-tick", { default: 1 })
    .option("test-time", { default: 0 })
    .option("rand-seed", { default: 12345 })
    .option("oss-cluster-api-distribute-subscribers", { default: false })
    .option("slot-refresh-interval", { default: -1 })
    .option("verbose", { default: false })
    .option("measure-rtt-latency", { default: true })
    .option("redis-timeout", { default: 120000 })
    .option("rate-limit", { description: "Max operations per second (0 for unlimited)", default: 0 })
    .help()
    .argv as BenchmarkArgs;
}
