#!/usr/bin/env ts-node

import { runBenchmark } from '../lib/redisManager';
import { parseArgs } from '../lib/config';

async function main(): Promise<void> {
  const argv = parseArgs();
  await runBenchmark(argv);
}

main().catch((err) => {
  console.error('Error running benchmark:', err);
  process.exit(1);
});
