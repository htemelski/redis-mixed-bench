import { createClient, createCluster } from "redis";
import { RttAccumulator } from "./metrics";
import { RateLimiter } from "./rateLimiter";

interface RunningRef {
  value: boolean;
}

interface MessagesRef {
  value: number;
}

interface CommandStats {
  set: number;
  get: number;
  hSet: number;
  hGet: number;
}


async function commanderRoutine(
  dataSize: number,
  client: ReturnType<typeof createCluster> | ReturnType<typeof createClient>,
  isRunningRef: RunningRef,
  totalMessagesRef: MessagesRef,
  rttAccumulator?: RttAccumulator | null,
  commandStats: CommandStats = { set: 0, get: 0, hSet: 0, hGet: 0 },
  rttHistogram?: any | null,
  rateLimiter?: RateLimiter | null
): Promise<CommandStats> {
    await client.connect();

    // Define keys and payload
    const payload = 'A'.repeat(dataSize);
    const stringKey = 'benchmark:string:key';
    const hashKey = 'benchmark:hash:key';
    const field = 'benchmark:field';
    
    let commandType: number = 0;
    while (isRunningRef.value) {
      try {
        // Apply rate limiting if enabled
        if (rateLimiter) {
          await rateLimiter.acquire();
        }
        
        commandType = Math.floor(Math.random() * 4);
        let rtt = 0;

        const startTime = performance.now();
        
        switch (commandType) {
        case 0:
          await client.set(stringKey, payload);
          commandStats.set++;
          break;
        case 1:
          await client.get(stringKey);
          commandStats.get++;
          break;
        case 2:
          await client.hSet(hashKey, field, payload);
          commandStats.hSet++;
          break;
        case 3:
          await client.hGet(hashKey, field);
          commandStats.hGet++;
          break;
        }
          
        const endTime = performance.now();
        rtt = endTime - startTime;

        if (rttAccumulator && rtt > 0) {
          rttAccumulator.add(rtt);
        }

        totalMessagesRef.value++;
      } catch (err) {
        console.error(`Error sending command:`, err, `Command type: ${commandType}`);
      }
    }

  return commandStats;
}

export { commanderRoutine, CommandStats };
