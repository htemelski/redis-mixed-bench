#!/usr/bin/env bash

# run-bench-mixed.sh - Run multiple instances of the Redis mixed command benchmark
# Usage: ./run-bench-mixed.sh <instances> [benchmark_args...]
#
# Example: ./run-bench-mixed.sh 3 --clients=100 --test-time=60

set -e

# Array to store PIDs of all benchmark processes
declare -a BENCHMARK_PIDS

# Cleanup function to kill all benchmark processes
cleanup() {
    echo
    echo "Interrupt received, terminating all benchmark processes..."
    for pid in "${BENCHMARK_PIDS[@]}"; do
        if ps -p "$pid" > /dev/null; then
            echo "Terminating process $pid"
            kill -TERM "$pid" 2>/dev/null || true
        fi
    done
    echo "All benchmark processes terminated."
    exit 0
}

# Set up trap to catch Ctrl+C and other termination signals
trap cleanup SIGINT SIGTERM

# Check if number of instances is provided
if [ $# -lt 1 ] || ! [[ $1 =~ ^[0-9]+$ ]]; then
    echo "Usage: $0 <number_of_instances> [benchmark_args...]"
    echo "Example: $0 3 --clients=100 --test-time=60"
    echo "Example with rate limiting: $0 1 --clients=10 --rate-limit=500 --test-time=30"
    exit 1
fi

# Extract number of instances and shift arguments
INSTANCES=$1
shift

# Calculate path to benchmark script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCHMARK_TS="${SCRIPT_DIR}/../bin/bench-mixed.ts"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"
TS_NODE_PATH="${PROJECT_ROOT}/node_modules/.bin/ts-node"

# Check if ts-node exists
if [ ! -f "$TS_NODE_PATH" ]; then
    echo "ts-node not found. Installing ts-node..."
    (cd "$PROJECT_ROOT" && npm install --save-dev ts-node)
    
    # Check if installation was successful
    if [ ! -f "$TS_NODE_PATH" ]; then
        echo "Error: Failed to install ts-node. Please install manually using 'npm install --save-dev ts-node'"
        exit 1
    fi
fi

BENCHMARK_CMD="${TS_NODE_PATH} ${BENCHMARK_TS}"

echo "Using benchmark command: $BENCHMARK_CMD"

echo "Starting $INSTANCES benchmark instances with arguments: $@"

# Create a temporary directory for output files
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTPUT_DIR="./out/bench_mixed_${TIMESTAMP}"
mkdir -p "$OUTPUT_DIR"
echo "Output files will be saved to $OUTPUT_DIR"

# Function to run a single benchmark instance
run_instance() {
    local instance_num=$1
    local args="$2"
    local output_file="${OUTPUT_DIR}/instance_${instance_num}.log"
    local json_output=""
    
    # If json-out-file is specified in args, modify it to be unique
    if [[ "$args" == *"--json-out-file"* ]]; then
        # Extract the json file path and make it unique per instance
        json_file=$(echo "$args" | grep -o -- "--json-out-file=[^ ]*" | cut -d= -f2)
        json_name=$(basename "$json_file" .json)
        json_dir=$(dirname "$json_file")
        json_output="${json_dir}/${json_name}_instance${instance_num}.json"
        
        # Replace the original json-out-file with the new one
        args=$(echo "$args" | sed "s|--json-out-file=$json_file|--json-out-file=$json_output|")
    fi
    
    # Use a unique random seed per instance if rand-seed is specified
    if [[ "$args" == *"--rand-seed"* ]]; then
        # Extract the seed and increment it for each instance
        original_seed=$(echo "$args" | grep -o -- "--rand-seed=[^ ]*" | cut -d= -f2)
        new_seed=$((original_seed + instance_num))
        args=$(echo "$args" | sed "s|--rand-seed=$original_seed|--rand-seed=$new_seed|")
    fi
    
    echo "Starting instance $instance_num with output to $output_file"
    if [[ -n "$json_output" ]]; then
        echo "JSON results will be saved to $json_output"
    fi
    
    # Run the benchmark command
    echo "$BENCHMARK_CMD $args" > "$output_file"
    $BENCHMARK_CMD $args >> "$output_file" 2>&1 &
    local pid=$!
    BENCHMARK_PIDS+=($pid)
    echo "Instance $instance_num started with PID $pid"
}

# Run the benchmark instances
for (( i=1; i<=$INSTANCES; i++ )); do
    run_instance $i "$*"
done

echo "All $INSTANCES benchmark instances have been started."
echo "Use 'tail -f ${OUTPUT_DIR}/instance_*.log' to monitor progress."
echo "Press Ctrl+C to terminate all benchmark instances."

# Wait for all background processes
wait

echo "All benchmark instances have completed."
echo "Results are available in $OUTPUT_DIR"