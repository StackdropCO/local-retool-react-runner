import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/live/**/*.live.test.ts'],
    passWithNoTests: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
