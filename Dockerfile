FROM python:3.12-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends nodejs npm \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm install
RUN npx playwright install --with-deps chromium

COPY . .

ENV HOST=0.0.0.0
ENV PORT=8000
ENV PLAYWRIGHT_PROFILE_DIR=/data/playwright-profile/immoscout

VOLUME ["/data"]

EXPOSE 8000

CMD ["python3", "server.py"]
