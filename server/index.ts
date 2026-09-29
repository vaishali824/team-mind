import 'dotenv/config'
import express from 'express'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HindsightServer, consoleLogger } from '@vectorize-io/hindsight-all'
import { HindsightClient } from '@vectorize-io/hindsight-client'
import { createApp } from './app.js'

const localMode = process.env.HINDSIGHT_MODE !== 'cloud'
const localServer = localMode
  ? new HindsightServer({
      profile: 'teammind',
      port: Number(process.env.HINDSIGHT_LOCAL_PORT || 8888),
      embedVersion: '0.10.1',
      env: {
        HINDSIGHT_API_LLM_PROVIDER: 'ollama',
        HINDSIGHT_API_LLM_MODEL: process.env.HINDSIGHT_LOCAL_MODEL || 'llama3.2:1b',
        HINDSIGHT_API_LLM_BASE_URL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
        HINDSIGHT_API_LLM_OLLAMA_NUM_CTX: process.env.HINDSIGHT_LOCAL_NUM_CTX || '4096',
        HINDSIGHT_API_LLM_STRICT_SCHEMA: 'true',
        HINDSIGHT_API_LLM_MAX_CONCURRENT: '2',
        HINDSIGHT_API_WORKER_MAX_SLOTS: '2',
        HINDSIGHT_API_RERANKER_PROVIDER: 'rrf',
        HINDSIGHT_API_EMBEDDINGS_LOCAL_FORCE_CPU: 'true',
        OMP_NUM_THREADS: '2',
      },
      logger: consoleLogger,
    })
  : undefined

async function closeServers(apiServer: Server) {
  await new Promise<void>((resolve, reject) => {
    apiServer.close((error) => error ? reject(error) : resolve())
  })
  await localServer?.stop()
}

async function start() {
  if (localServer) {
    console.log('Starting local Hindsight with embedded PostgreSQL and Ollama...')
    await localServer.start()
  }

  const baseUrl = localServer?.getBaseUrl() || process.env.HINDSIGHT_BASE_URL || 'http://localhost:8888'
  const client = new HindsightClient({
    baseUrl,
    apiKey: localMode ? undefined : process.env.HINDSIGHT_API_KEY || undefined,
  })
  const app = createApp(client, { localMode })

  if (process.env.NODE_ENV === 'production') {
    const buildDirectory = fileURLToPath(new URL('../dist', import.meta.url))
    app.use(express.static(buildDirectory))
    app.use((_request, response) => response.sendFile(join(buildDirectory, 'index.html')))
  }

  const port = Number(process.env.PORT || 3001)
  const apiServer = app.listen(port, () => {
    console.log(`TeamMind API listening at http://localhost:${port}`)
    console.log(`Hindsight endpoint: ${baseUrl}`)
  })

  const shutdown = () => {
    void closeServers(apiServer).catch((error: unknown) => {
      console.error('Shutdown failed:', error)
      process.exitCode = 1
    })
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

void start().catch((error: unknown) => {
  console.error('TeamMind startup failed:', error)
  process.exitCode = 1
})