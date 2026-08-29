#!/bin/bash
set -e

# ==============================================================================
# compile-circuits.sh
# Automated Circom compilation pipeline to generate WASM and zkey files
# ==============================================================================

echo "Starting Circom compilation pipeline..."

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CIRCUITS_DIR="$ROOT_DIR/zk-proof-service/circuits"
BUILD_DIR="$ROOT_DIR/zk-proof-service/build"
PTAU_DIR="$ROOT_DIR/zk-proof-service/ptau"

# The standard powers of tau file
PTAU_FILE="$PTAU_DIR/pot12_final.ptau"
PTAU_URL="https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_12.ptau"

mkdir -p "$BUILD_DIR"
mkdir -p "$PTAU_DIR"

if [ ! -f "$PTAU_FILE" ]; then
    echo "Downloading Powers of Tau file..."
    curl -L -o "$PTAU_FILE" "$PTAU_URL"
else
    echo "Powers of Tau file already exists."
fi

# Ensure circom is installed
if ! command -v circom &> /dev/null; then
    echo "Error: circom could not be found. Please install it to compile circuits."
    exit 1
fi

for circuit_file in "$CIRCUITS_DIR"/*.circom; do
    [ -e "$circuit_file" ] || continue
    
    filename=$(basename "$circuit_file")
    circuit_name="${filename%.circom}"
    
    echo "Compiling $circuit_name..."
    
    # 1. Compile the circuit (generates WASM, R1CS, and Symbol file)
    circom "$circuit_file" --r1cs --wasm --sym -o "$BUILD_DIR"
    
    # 2. Setup Groth16 (generate initial zkey)
    echo "Running groth16 setup..."
    npx snarkjs groth16 setup "$BUILD_DIR/$circuit_name.r1cs" "$PTAU_FILE" "$BUILD_DIR/${circuit_name}_0000.zkey"
    
    # 3. Contribute to the phase 2 ceremony (creates final zkey)
    echo "Contributing to phase 2..."
    npx snarkjs zkey contribute "$BUILD_DIR/${circuit_name}_0000.zkey" "$BUILD_DIR/${circuit_name}_final.zkey" --name="AutomatedBuild" -v -e="$(head -c 32 /dev/urandom | base64)"
    
    # 4. Export verification key
    echo "Exporting verification key..."
    npx snarkjs zkey export verificationkey "$BUILD_DIR/${circuit_name}_final.zkey" "$BUILD_DIR/${circuit_name}_verification_key.json"
    
    # 5. Generate Solidity verifier
    echo "Generating Solidity verifier..."
    npx snarkjs zkey export solidityverifier "$BUILD_DIR/${circuit_name}_final.zkey" "$BUILD_DIR/${circuit_name}Verifier.sol"

    # NOTE: Soroban verifiers can be generated using a Rust-based toolchain
    # (e.g. from snarkjs output). This pipeline acts as the foundation.
    
    echo "$circuit_name successfully compiled and artifacts generated."
done

echo "Circom compilation pipeline completed successfully."
