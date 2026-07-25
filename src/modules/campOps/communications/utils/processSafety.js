function formatError(error) {
  if (!error) return 'Unknown error';
  if (error.stack) return error.stack;
  return String(error.message || error);
}

export function registerProcessSafetyHandlers() {
  process.on('unhandledRejection', (reason) => {
    console.error('[process] Unhandled promise rejection (server continues):', formatError(reason));
  });

  process.on('uncaughtException', (error) => {
    console.error('[process] Uncaught exception (server continues):', formatError(error));
  });
}

export function logIngestError(scope, error, context = {}) {
  const details = Object.entries(context)
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => `${key}=${value}`)
    .join(' | ');
  const prefix = details ? `[${scope}] ${details}` : `[${scope}]`;
  console.error(`${prefix} —`, error?.message || error);
  if (error?.stack && process.env.NODE_ENV !== 'production') {
    console.error(error.stack);
  }
}
