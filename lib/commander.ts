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
    while (isRunningRef.value) {
      try {
        if (rateLimiter) {
          await rateLimiter.acquire();
        }
        
        commandType = Math.floor(Math.random() * 4);
        let rtt = 0;

        let startTime: number = 0;
        let endTime: number = 0;

        switch (commandType) {
        case 0:
          const setKey = setKeys[Math.floor(Math.random() * setKeys.length)]

          startTime = performance.now();
          await client.set(setKey, payload);
          endTime = performance.now();

          commandStats.set++;
          break;
        case 1:
          const getKey = getKeys[Math.floor(Math.random() * getKeys.length)]

          startTime = performance.now();
          await client.get(getKey);
          endTime = performance.now();

          commandStats.get++;
          break;
        case 2:
          const hsetKey = hsetKeys[Math.floor(Math.random() * hsetKeys.length)]

          startTime = performance.now();
          await client.hSet(hsetKey, hashField, payload);
          endTime = performance.now();

          commandStats.hSet++;
          break;
        case 3:
          const hgetKey = hgetKeys[Math.floor(Math.random() * hgetKeys.length)]

          startTime = performance.now();
          await client.hGet(hgetKey, hashField);
          endTime = performance.now();

          commandStats.hGet++;
          break;
        }
          
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
