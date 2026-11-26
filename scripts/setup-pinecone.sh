#!/usr/bin/env bash
# Optional one-time Pinecone index creation with integrated embeddings.
set -euo pipefail
: "${PINECONE_API_KEY:?set PINECONE_API_KEY}"
NAME="${1:-harmedi}"
V="${PINECONE_API_VERSION:-2026-04}"

curl -sS https://api.pinecone.io/indexes/create-for-model \
  -H "Api-Key: $PINECONE_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Pinecone-Api-Version: $V" \
  -d "{
    \"name\": \"$NAME\",
    \"cloud\": \"aws\",
    \"region\": \"us-east-1\",
    \"embed\": { \"model\": \"llama-text-embed-v2\", \"field_map\": { \"text\": \"text\" } }
  }"
echo
echo "index host:"
curl -sS "https://api.pinecone.io/indexes/$NAME" \
  -H "Api-Key: $PINECONE_API_KEY" -H "X-Pinecone-Api-Version: $V" | grep -o '"host":"[^"]*"'
