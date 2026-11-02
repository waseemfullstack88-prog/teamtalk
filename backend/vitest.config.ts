import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    fileParallelism: false, // tests share one real PostgreSQL instance
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://teamtalk:teamtalk@localhost:54329/teamtalk_test',
      JWT_SECRET: 'test-jwt-secret-test-jwt-secret-1234',
      DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      FILE_SIGNING_SECRET: 'test-file-signing-secret-1234567890',
      TURN_SECRET: 'test-turn-secret-1234',
      TURN_URLS: 'stun:turn.example.test:3478,turn:turn.example.test:3478?transport=udp,turns:turn.example.test:5349?transport=tcp',
      LOCAL_STORAGE_DIR: './.test-storage',
      APP_URL: 'http://localhost:5173',
      WEBAUTHN_ORIGIN: 'http://localhost:5173',
      RATE_LIMIT_DISABLED: 'true',
    },
  },
});
