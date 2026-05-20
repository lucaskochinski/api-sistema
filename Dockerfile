# --- Imagem Base ---
FROM node:18-alpine

# Instalar utilitários adicionais que extensões nativas do npm possam requerer
RUN apk add --no-cache python3 make g++ gcc libc-dev

# Diretório de trabalho
WORKDIR /usr/src/app

# Copiar arquivos de dependências
COPY package*.json ./

# Instalar dependências (npm ci garante instalação limpa baseada no lock)
RUN npm ci

# Copiar o restante da aplicação
COPY . .

# Expor a porta padrão da API
EXPOSE 3000

# Executar migrações do banco e iniciar a API Express
CMD ["npm", "start"]
