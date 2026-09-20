# Image de l'API crypto. Le contexte de construction est la racine du depot :
# l'API importe application/_commun/api/ et le package.json de la racine.
FROM node:22-alpine

WORKDIR /app

# Couche dependances separee : reconstruite seulement si le verrou change
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY application ./application

# Dans un conteneur, l'ecoute doit couvrir toutes les interfaces :
# sur 127.0.0.1 le processus resterait injoignable depuis le NAS.
ENV NODE_ENV=production \
    CRYPTO_API_HOST=0.0.0.0 \
    CRYPTO_API_PORT=9998

EXPOSE 9998

USER node

CMD ["node", "application/crypto/api/serveur.js"]
