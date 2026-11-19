/**
 * One automatic reload is enough when the first navigation raced content-script
 * registration. Unknown means the tab could not be probed, so do not reload.
 */
export function shouldRetryInjection(input: {
  enabled: boolean;
  injected: boolean | null;
  retries: number;
}): boolean {
  if (input.injected == null) return false;
  if (input.retries >= 1) return false;
  return input.enabled !== input.injected;
}
