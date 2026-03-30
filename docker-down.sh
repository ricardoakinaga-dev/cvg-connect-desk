#!/usr/bin/env sh
# Script para derrubar containers e limpar volumes (opcional)

set -e

echo "Parando containers..."
docker compose down

echo
echo " containers parados."
echo
echo "Para remover volumes (PostgreSQL e Redis) também:"
echo "  docker compose down -v"