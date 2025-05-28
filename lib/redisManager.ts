import { createClient, createCluster, RedisClientOptions, RedisClusterOptions, RedisClientType, RedisClusterType } from "redis";
import { commanderRoutine, CommandStats } from "./commander";
import { updateCLI, writeFinalResults, createRttHistogram, RttAccumulator } from "./metrics";
import { RateLimiter } from "./rateLimiter";
import seedrandom from "seedrandom";
import { BenchmarkArgs } from "./config";

interface CountRef {
  value: number;
}

interface RunningRef {
  value: boolean;
}

export async function runBenchmark(argv: BenchmarkArgs): Promise<void> {
  console.log(`pubsub-sub-bench (node-redis version)`);
  console.log(`Using random seed: ${argv["rand-seed"]}`);
  Math.random = seedrandom(argv["rand-seed"].toString());

  if (argv["measure-rtt-latency"]) {
    console.log("RTT measurement enabled.");
  }

  if (argv.verbose) {
    console.log("Verbose mode enabled.");
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

  const clientOptions: RedisClientOptions = {
    socket: {
      host: argv.host,
      port: argv.port,
      connectTimeout: 120000,
    },
    username: argv.user || undefined,
    password: argv.a || undefined,
    disableClientInfo: true,
  };

  const clusterOptions: RedisClusterOptions = {
    rootNodes: [
      {
        disableClientInfo: true,
        socket: {
          host: argv.host,
          port: argv.port,
          connectTimeout: 120000,
        },
      },
    ],
    useReplicas: false,
    defaults: {
      disableClientInfo: true,
      username: argv.user || undefined,
      password: argv.a || undefined,
      socket: {
        connectTimeout: 120000,
      },
    },
    minimizeConnections: true,
  };

  console.log(`Using ${argv["slot-refresh-interval"]} slot-refresh-interval`);
  console.log(`Using ${argv["redis-timeout"]} redis-timeout`);

  let clients: (ReturnType<typeof createCluster> | ReturnType<typeof createClient>)[] = [];

  for (let i = 1; i <= argv.clients; i++) {
    let client;
    if (argv["oss-cluster-api-distribute-subscribers"] === true) {
      client = createCluster(clusterOptions);
    } else {
      client = createClient(clientOptions);
    }

    clients.push(client);
  }

  const promises: Promise<CommandStats>[] = [];

  const publisherName = `publisher-${Math.random().toString(36).substring(7)}`;
  const channels: string[] = ['test-channel']; // Add your channel logic here

  for (let clientId = 1; clientId <= argv.clients; clientId++) {
    promises.push(
      commanderRoutine(
        argv["data-size"],
        clients[clientId - 1],
        isRunningRef,
        totalMessagesRef,
        rttAccumulator,
        { set: 0, get: 0, hSet: 0, hGet: 0 },
        rttHistogram,
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
      rttAccumulator,
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

function randomInt(min: number, max: number): number {
  if (min === max) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
