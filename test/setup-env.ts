// Runs before each e2e file, so AdminKeyGuard is ENFORCED during the suite rather than
// silently disabled. Without this the tests would pass only because an unset ADMIN_API_KEY
// makes the guard a no-op — which means the guard could regress and the suite would still
// be green, and hardening it later would break CI.
process.env.ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? 'test-admin-key';

export const TEST_ADMIN_KEY = process.env.ADMIN_API_KEY;
