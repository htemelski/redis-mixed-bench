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
  'measure-rtt-latency': boolean;
  'redis-timeout': number;
  'rate-limit': number;
  tls: boolean;
  'tls-key': string;
  'tls-cert': string;
  'tls-ca': string;
  'tls-key-passphrase': string;
  'reject-unauthorized': boolean;
  'keys-count': number;
  'hit-rate': number;
  'key-prefix': string;
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
    .option("measure-rtt-latency", { default: true })
    .option("redis-timeout", { default: 120000 })
    .option("rate-limit", { description: "Max operations per second (0 for unlimited)", default: 0 })
    .option("tls", { description: "Enable TLS/SSL connection", default: false })
    .option("tls-key", { description: "Path to client private key file", default: "" })
    .option("tls-cert", { description: "Path to client certificate file", default: "" })
    .option("tls-ca", { description: "Path to CA certificate file", default: "" })
    .option("tls-key-passphrase", { description: "Passphrase for encrypted private key file", default: "" })
    .option("reject-unauthorized", { description: "Reject unauthorized TLS/SSL certificates", default: true })
    .option("keys-count", { description: "Number of keys to be used", default: 16384 })
    .option("hit-rate", { description: "average hit rate for get and hget", default: 100 })
    .option("key-prefix", { description: "prefix for the keys used in the benchmark", default: "mixed-bench" })
    .help()
    .argv as BenchmarkArgs;
}
