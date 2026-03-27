#!/bin/bash
cd "$(dirname "$0")"
exec npx tsx watch server/_core/index.ts
