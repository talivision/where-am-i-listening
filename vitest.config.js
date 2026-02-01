import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/**/*.test.js'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            include: ['shared/**/*.js', 'worker/src/**/*.js'],
        },
        testTimeout: 10000, // 10 second timeout for API mocking tests
    },
});
