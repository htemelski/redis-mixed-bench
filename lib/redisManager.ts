import { createClient, createCluster, RedisClientOptions, RedisClusterOptions } from "redis";
import { RedisSocketOptions } from "@redis/client/dist/lib/client/socket"
import { commanderRoutine, CommandStats } from "./commander";
import { updateCLI, writeFinalResults, createRttHistogram, RttAccumulator } from "./metrics";
import { RateLimiter } from "./rateLimiter";
import seedrandom from "seedrandom";
import { BenchmarkArgs } from "./config";
import * as fs from 'fs';

interface CountRef {
  value: number;
}

interface RunningRef {
  value: boolean;
}

export async function runBenchmark(argv: BenchmarkArgs): Promise<void> {
  console.log(`redis-mixed-bench (node-redis version)`);
  console.log(`Using random seed: ${argv["rand-seed"]}`);
  Math.random = seedrandom(argv["rand-seed"].toString());

  if (argv["measure-rtt-latency"]) {
    console.log("RTT measurement enabled.");
  }

  if (argv.tls) {
    console.log("TLS enabled.");
    if (argv["tls-ca"]) console.log("Using CA certificate from:", argv["tls-ca"]);
    if (argv["tls-cert"]) console.log("Using client certificate from:", argv["tls-cert"]);
    if (argv["tls-key"]) console.log("Using client key from:", argv["tls-key"]);
    if (argv["tls-key-passphrase"]) console.log("Using key passphrase:", argv["tls-key-passphrase"]);
  }

  // Shared mutable state (as references)
  const totalMessagesRef: CountRef = { value: 0 };
  const totalSubscribedRef: CountRef = { value: 0 };
  const totalConnectsRef: CountRef = { value: 0 };
  const isRunningRef: RunningRef = { value: true };
  const messageRateTs: number[] = [];

  // Create rate limiter if specified
  const rateLimiter = argv["rate-limit"] && argv["rate-limit"] > 0
    ? new RateLimiter(argv["rate-limit"] / argv.clients) // Distribute rate limit across clients
    : null;
    
  if (rateLimiter) {
    console.log(`Rate limiting enabled: ${argv["rate-limit"]} ops/sec (${Math.ceil(argv["rate-limit"] / argv.clients)} per client)`);
  }

  // Create efficient RTT tracking
  const rttAccumulator = argv["measure-rtt-latency"]
    ? new RttAccumulator()
    : null;
  // Create histogram for RTT recording
  const rttHistogram = argv["measure-rtt-latency"]
    ? createRttHistogram()
    : null;
    
  // Connect the accumulator with the histogram for direct recording
  if (rttAccumulator && rttHistogram) {
    rttAccumulator.setHistogram(rttHistogram);
  }

  // Create socket options with TLS configuration if enabled
  const socketOptions: RedisSocketOptions = {
    host: argv.host,
    port: argv.port,
    connectTimeout: argv["redis-timeout"],
    tls: argv.tls,
    rejectUnauthorized: argv["reject-unauthorized"] ? argv["reject-unauthorized"] : undefined,
    key: argv["tls-key"] ? await fs.promises.readFile(argv["tls-key"], 'utf-8') : undefined,
    passphrase: argv["tls-key-passphrase"] ? argv["tls-key-passphrase"] : undefined,
    cert: argv["tls-cert"] ? await fs.promises.readFile(argv["tls-cert"], 'utf-8') : undefined,
    ca: argv["tls-ca"] ? await fs.promises.readFile(argv["tls-ca"], 'utf-8') : undefined,
  };

  const clientOptions: RedisClientOptions = {
    socket: socketOptions,
    username: argv.user || undefined,
    password: argv.a || undefined,
    disableClientInfo: true
  };

  const clusterOptions: RedisClusterOptions = {
    rootNodes: [
      {
        disableClientInfo: true,
        socket: socketOptions
      },
    ],
    useReplicas: false,
    defaults: {
      disableClientInfo: true,
      username: argv.user || undefined,
      password: argv.a || undefined,
      socket: socketOptions
    },
    minimizeConnections: true,
  };

  console.log(`Using ${argv["redis-timeout"]} redis-timeout`);

  let clients: (ReturnType<typeof createCluster> | ReturnType<typeof createClient>)[] = [];

  for (let i = 0; i <= argv.clients; i++) {
    let client;
    if (argv["oss-cluster-api-distribute-subscribers"] === true) {
      client = createCluster(clusterOptions);
    } else {
      client = createClient(clientOptions);
    }

    clients.push(client);
  }
  if (clients.length < 2) {
    console.error("not enough clients");
    process.exit(1);
  }

  const promises: Promise<CommandStats>[] = [];

  if (argv["hit-rate"] > 100 || argv["hit-rate"] < 0) {
    console.warn("hit-rate can't be higher than 100 or lower than 0, setting it to the default value");
    argv["hit-rate"] = 100;
  }

  const getKeys: Array<string> = [];
  const hgetKeys: Array<string> = [];
  const hashField: string = `${argv["key-prefix"]}:field`

  for (let i = 0; i < argv["keys-count"]; i++) {
    getKeys.push(`${argv["key-prefix"]}:string:${i}`);
    hgetKeys.push(`${argv["key-prefix"]}:hash:${i}`);
  }

  const prepClient = clients[0];
  clients.shift();

  console.log("preparing the server keys");
  await prepClient.connect();

  const deletePromises: Array<Promise<any>> = [];
  for (let i = 0; i < argv["keys-count"]; i++) {
    deletePromises.push(prepClient.del(getKeys[i]));
    deletePromises.push(prepClient.hDel(hgetKeys[i], hashField));
  }
  await Promise.all(deletePromises);

  const setKeys: Array<string> = [];
  const hsetKeys: Array<string> = [];

  const setKeysCount: number = Math.floor((argv["keys-count"] * (argv["hit-rate"] / 100)))

  for (let i = 0; i < setKeysCount; i++) {
    setKeys.push(getKeys[i]);
    hsetKeys.push(hgetKeys[i]);
  }

  const setPromises: Array<Promise<any>> = [];
  for (let i = 0; i < setKeysCount; i++) {
    setPromises.push(prepClient.set(getKeys[i], "someValue"));
    setPromises.push(prepClient.hSet(hgetKeys[i], hashField, "someValue"));
  }
  await Promise.all(setPromises);

  await prepClient.disconnect()
  console.log("preparation finished");

  for (let clientId = 0; clientId < argv.clients; clientId++) {
    promises.push(
      commanderRoutine(
        argv["data-size"],
        clients[clientId],
        isRunningRef,
        totalMessagesRef,
        getKeys,
        setKeys,
        hgetKeys,
        hsetKeys,
        hashField,
        rttAccumulator,
        rateLimiter
      )
    );

    totalConnectsRef.value++;
  }

  try {
    const { startTime, now, perSecondStats } = await updateCLI(
      argv["client-update-tick"],
      0,
      argv["test-time"],
      isRunningRef,
      totalMessagesRef,
      totalConnectsRef,
      messageRateTs,
      rttAccumulator,
      rttHistogram
    );

    // Wait for all routines to finish
    console.log("Waiting for all clients to shut down cleanly...");
    const clientStats = await Promise.all(promises);
    
    // Aggregate command statistics from all clients
    const totalStats: CommandStats = {
      set: 0,
      get: 0,
      hSet: 0,
      hGet: 0
    };
    
    // Sum up statistics from each client
    for (const stats of clientStats) {
      totalStats.set += stats.set;
      totalStats.get += stats.get;
      totalStats.hSet += stats.hSet;
      totalStats.hGet += stats.hGet;
    }
    
    // Log the combined command statistics
    console.log('\nTotal Command Statistics (all clients):');
    console.log(`SET commands: ${totalStats.set} (${(totalStats.set / totalMessagesRef.value * 100).toFixed(2)}%)`);
    console.log(`GET commands: ${totalStats.get} (${(totalStats.get / totalMessagesRef.value * 100).toFixed(2)}%)`);
    console.log(`HSET commands: ${totalStats.hSet} (${(totalStats.hSet / totalMessagesRef.value * 100).toFixed(2)}%)`);
    console.log(`HGET commands: ${totalStats.hGet} (${(totalStats.hGet / totalMessagesRef.value * 100).toFixed(2)}%)`);
    console.log(`Total commands: ${totalMessagesRef.value}`);

    // THEN output final results
    writeFinalResults(
      startTime,
      now,
      argv,
      totalMessagesRef.value,
      totalSubscribedRef.value,
      messageRateTs,
      rttHistogram,
      perSecondStats
    );
  } finally {
    // Clean shutdown of Redis connection
    console.log("Shutting down Redis connection...");
    try {
      for (let i = 0; i < argv.clients; i++) {
        await clients[i].quit();
      }
      console.log("Redis connection closed successfully");
    } catch (err) {
      console.error("Error disconnecting Redis client:", err);
    }
  }

  // cleanly exit the process once done
  process.exit(0);
}
