# mixed workload bench (node-redis Edition)

High-performance **Redis Commands benchmark tool**, written in Node.js.  
Supports both **standalone** and **Redis OSS Cluster** modes, with support for basic Redis commands like `SET`, `GET`, `HSET`, and `HGET`.

--- 

## 📦 Installation

```bash
npm install
```

## Usage

This benchmark tool allows testing Redis performance with various parameters:

```bash
# Run directly with ts-node
./scripts/run-bench-mixed.sh <instances> [benchmark_args...]

# Example with 3 instances, 100 clients per instance, running for 60 seconds
./scripts/run-bench-mixed.sh 3 --clients=100 --test-time=60

# Example with rate limiting (500 operations per second) (rate limit is per instance)
./scripts/run-bench-mixed.sh 1 --clients=10 --test-time=30 --rate-limit=500
```

## Available Options

### Basic Configuration
- `--clients=N`: Number of concurrent connections to use (default: 1)
- `--test-time=N`: Duration of the test in seconds (default: 0, runs indefinitely)
- `--data-size=N`: Size of the payload data in bytes (default: 300)
- `--rate-limit=N`: Maximum operations per second (default: 0, no limit)
- `--host=ADDR`: Redis server address (default: 127.0.0.1)
- `--port=N`: Redis server port (default: 6379)

### Authentication
- `--a=PASSWORD`: Password for Redis authentication
- `--user=USERNAME`: Username for Redis ACL authentication

### Cluster Mode
- `--oss-cluster-api-distribute-subscribers`: Enable Redis OSS Cluster mode (default: false)
- `--slot-refresh-interval=N`: Cluster slot refresh interval in milliseconds (default: -1)

### Monitoring and Output
- `--measure-rtt-latency`: Enable/disable latency measurements (default: true)
- `--json-out-file=FILE`: Write results to JSON file
- `--client-update-tick=N`: Update interval for progress display in seconds (default: 1)

### Advanced Settings
- `--rand-seed=N`: Random seed for reproducibility (default: 12345)
- `--redis-timeout=N`: Redis connection timeout in milliseconds (default: 120000)
