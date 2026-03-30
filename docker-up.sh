#!/usr/bin/env sh
# Script para preparar ambiente Docker e subir o projeto

set -e

echo "=== Connect Desk Docker Setup ==="

# Verificar se .env existe, caso contrário copiar de .env.example
if [ ! -f .env ]; then
  echo "Criando .env a partir de .env.example..."
  cp .env.example .env
  echo "Arquivo .env criado. Ajuste as variáveis se necessário."
else
  echo ".env já existe."
fi

# Exportar variáveis do .env para o compose
export $(grep -v '^#' .env | xargs)

echo "Subindo containers com Docker Compose..."
docker compose up -d

echo "Aguardando servicios..."
sleep 5

echo
echo "=== Status dos Containers ==="
docker compose ps

echo
echo "A aplicação estará disponível em:"
echo "  - Frontend:  http://localhost:8081"
echo "  - API:       http://localhost:3000"
echo "  - API Docs:  http://localhost:3000/docs"
echo "  - Realtime:  ws://localhost:8080"
echo
echo "Para ver logs: docker compose logs -f"
echo "Para parar:   docker compose down"