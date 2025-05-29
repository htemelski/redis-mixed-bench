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
  getKeys: Array<string>,
  setKeys: Array<string>,
  hgetKeys: Array<string>,
  hsetKeys: Array<string>,
  hashField: string,
  rttAccumulator?: RttAccumulator | null,
  rateLimiter?: RateLimiter | null,
): Promise<CommandStats> {
    await client.connect();

    const commandStats: CommandStats = { set: 0, get: 0, hSet: 0, hGet: 0 };
    const payload = 'A'.repeat(dataSize);
    let commandType: number = 0;
    const field = hashField;
    while (isRunningRef.value) {
      try {
        if (rateLimiter) {
          await rateLimiter.acquire();
        }
        
        commandType = Math.floor(Math.random() * 4);
        let rtt = 0;

        const startTime = performance.now();
      
        switch (commandType) {
        case 0:
          const setKey = setKeys[Math.floor(Math.random() * setKeys.length)]
          await client.set(setKey, payload);
          commandStats.set++;
          break;
        case 1:
          const getKey = getKeys[Math.floor(Math.random() * getKeys.length)]

          await client.get(getKey);
          commandStats.get++;
          break;
        case 2:
          const hsetKey = hsetKeys[Math.floor(Math.random() * hsetKeys.length)]

          await client.hSet(hsetKey, field, payload);
          commandStats.hSet++;
          break;
        case 3:
          const hgetKey = hgetKeys[Math.floor(Math.random() * hgetKeys.length)]

          await client.hGet(hgetKey, field);
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
