import * as fs from 'fs';
import * as hdr from 'hdr-histogram-js';

interface BenchmarkConfig {
  'messages': number;
  'measure-rtt-latency': boolean;
  'json-out-file': string;
  host: string;
  port: number;
  'oss-cluster-api-distribute-subscribers': boolean;
  'rate-limit'?: number;
}

interface PerSecondStat {
  second: number;
  messages: number;
  messageRate: number;
  avgRttMs: number | null;
}

interface BenchmarkResult {
  StartTime: number;
  Duration: number;
  MessageRate: number;
  TotalMessages: number;
  TotalSubscriptions: number;
  MessagesPerChannel: number;
  MessageRateTs: number[];
  OSSDistributedSlots: boolean;
  Addresses: string[];
  PerSecondStats: PerSecondStat[];
  RateLimit?: number;
  RTTSummary?: {
    AvgMs: number;
    P50Ms: number;
    P95Ms: number;
    P99Ms: number;
    P999Ms: number;
    totalCount: number;
  };
}

export class RttAccumulator {
  private sum!: number;
  private count!: number;
  private currentHistogram: hdr.Histogram | null = null;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.sum = 0;
    this.count = 0;
  }

  // Set the histogram to update directly
  setHistogram(histogram: hdr.Histogram): void {
    this.currentHistogram = histogram;
  }

  add(value: number): void {
    // Only record values greater than 0
    if (value > 0) {
      this.sum += value;
      this.count++;
      
      // If we have a histogram, record the value directly
      if (this.currentHistogram) {
        // Convert to microseconds for more precise measurements
        // and ensure it's at least 1 (the minimum value the histogram accepts)
        const valueInMicros = Math.max(Math.floor(value * 1000), 1);
        this.currentHistogram.recordValue(valueInMicros);
      }
    }
  }

  getAverage(): number | null {
    return this.count > 0 ? this.sum / this.count : null;
  }

  get totalCount(): number {
    return this.count;
  }
}

export function createRttHistogram(): hdr.Histogram {
  return hdr.build({
    lowestDiscernibleValue: 1,           // 1 microsecond minimum
    highestTrackableValue: 60_000_000,   // 60 seconds in microseconds
    numberOfSignificantValueDigits: 3    // Precision digits
  });
}

function formatRow(row: (string | number)[]): string {
  const widths = [6, 15, 14, 14, 22, 14];
  return row.map((val, i) => String(val).padEnd(widths[i] || 10)).join('');
}

interface RunningRef {
  value: boolean;
}

interface CountRef {
  value: number;
}

interface UpdateCLIResult {
  startTime: number;
  now: number;
  perSecondStats: PerSecondStat[];
  sigint?: boolean;
}

export async function updateCLI(
  updateInterval: number,
  messageLimit: number,
  testTime: number,
  isRunningRef: RunningRef,
  totalMessagesRef: CountRef,
  totalConnectsRef: CountRef,
  messageRateTs: number[],
  rttAccumulator: RttAccumulator | null,
  rttHistogram?: hdr.Histogram | null
): Promise<UpdateCLIResult> {
  return new Promise((resolve) => {
    let prevTime = Date.now();
    let prevMessageCount = 0;
    let prevConnectCount = 0;
    let startTime = Date.now();
    let resolved = false;

    console.log('Starting benchmark...');

    const header = ['Time', 'Total Messages', 'Message Rate', 'Connect Rate'];
    if (rttAccumulator) {
      header.push('Avg RTT (ms)');
    }
    console.log(formatRow(header));
    const perSecondStats: PerSecondStat[] = [];

    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - prevTime) / 1000;

      const messageRate = (totalMessagesRef.value - prevMessageCount) / elapsed;
      const connectRate = (totalConnectsRef.value - prevConnectCount) / elapsed;

      if (prevMessageCount === 0 && totalMessagesRef.value !== 0) {
        startTime = Date.now();
      }

      if (totalMessagesRef.value !== 0) {
        messageRateTs.push(messageRate);
      }

      prevMessageCount = totalMessagesRef.value;
      prevConnectCount = totalConnectsRef.value;
      prevTime = now;

      const metrics = [
        Math.floor((now - startTime) / 1000),
        totalMessagesRef.value,
        messageRate.toFixed(2),
        connectRate.toFixed(2),
      ];

      let avgRttMs: number | null = null;

      if (rttAccumulator) {
        if (rttAccumulator.totalCount > 0) {
          avgRttMs = rttAccumulator.getAverage();
          metrics.push(avgRttMs ? avgRttMs.toFixed(3) : '--');
          
          // We don't need to transfer values anymore since they're
          // already being recorded directly in the histogram
          
          rttAccumulator.reset();
        } else {
          metrics.push('--');
        }
      }

      perSecondStats.push({
        second: Math.floor((now - startTime) / 1000),
        messages: totalMessagesRef.value,
        messageRate: Number(messageRate.toFixed(2)),
        avgRttMs: avgRttMs !== null ? Number(avgRttMs.toFixed(3)) : null
      });

      console.log(formatRow(metrics));

      const shouldStop =
        (messageLimit > 0 && totalMessagesRef.value >= messageLimit) ||
        (testTime > 0 && now - startTime >= testTime * 1000 && totalMessagesRef.value !== 0);

      if (shouldStop && !resolved) {
        resolved = true;
        clearInterval(interval);
        isRunningRef.value = false;
        resolve({ startTime, now, perSecondStats });
      }
    }, updateInterval * 1000);

    process.on('SIGINT', () => {
      if (!resolved) {
        console.log('\nReceived Ctrl-C - shutting down');
        clearInterval(interval);
        isRunningRef.value = false;
        resolved = true;
        resolve({ startTime, now: Date.now(), perSecondStats, sigint: true });
      }
    });
  });
}

export function writeFinalResults(
  start: number,
  end: number,
  argv: BenchmarkConfig,
  totalMessages: number,
  totalSubscribed: number,
  messageRateTs: number[],
  rttAccumulator: RttAccumulator | null,
  rttHistogram: hdr.Histogram | null,
  perSecondStats: PerSecondStat[]
): void {
  const duration = (end - start)/1000;
  const messageRate = totalMessages / duration;

  console.log('#################################################');
  console.log(`Total Duration: ${duration.toFixed(6)} Seconds`);
  console.log(`Message Rate: ${messageRate.toFixed(6)} msg/sec`);

  const result: BenchmarkResult = {
    StartTime: Math.floor(start),
    Duration: duration,
    MessageRate: messageRate,
    TotalMessages: totalMessages,
    TotalSubscriptions: totalSubscribed,
    MessagesPerChannel: argv['messages'],
    MessageRateTs: messageRateTs,
    OSSDistributedSlots: argv['oss-cluster-api-distribute-subscribers'],
    Addresses: [`${argv.host}:${argv.port}`],
    PerSecondStats: perSecondStats
  };

  if (argv['rate-limit'] && argv['rate-limit'] > 0) {
    result.RateLimit = argv['rate-limit'];
    console.log(`Rate Limit: ${argv['rate-limit']} ops/sec`);
  }

  if (argv['measure-rtt-latency'] && rttHistogram) {
    const avgRtt = rttHistogram.mean / 1000; // Convert from μs to ms
    const p50 = rttHistogram.getValueAtPercentile(50) / 1000;
    const p95 = rttHistogram.getValueAtPercentile(95) / 1000;
    const p99 = rttHistogram.getValueAtPercentile(99) / 1000;
    const p999 = rttHistogram.getValueAtPercentile(99.9) / 1000;

    result.RTTSummary = {
      AvgMs: Number(avgRtt.toFixed(3)),
      P50Ms: Number(p50.toFixed(3)),
      P95Ms: Number(p95.toFixed(3)),
      P99Ms: Number(p99.toFixed(3)),
      P999Ms: Number(p999.toFixed(3)),
      totalCount: rttHistogram.totalCount
    };

    console.log(`Avg  RTT       ${avgRtt.toFixed(3)} ms`);
    console.log(`P50  RTT       ${p50.toFixed(3)} ms`);
    console.log(`P95  RTT       ${p95.toFixed(3)} ms`);
    console.log(`P99  RTT       ${p99.toFixed(3)} ms`);
    console.log(`P999 RTT       ${p999.toFixed(3)} ms`);
    console.log(`Total Messages tracked latency      ${rttHistogram.totalCount} messages`);
  }

  console.log('#################################################');

  if (argv['json-out-file']) {
    fs.writeFileSync(argv['json-out-file'], JSON.stringify(result, null, 2));
    console.log(`Results written to ${argv['json-out-file']}`);
  }
}
