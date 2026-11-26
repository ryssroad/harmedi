// Loaded first by entrypoints so .env is available before other modules read process.env.
try {
  process.loadEnvFile();
} catch {}
