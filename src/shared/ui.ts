export function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing interface element ${selector}`);
  return found;
}
export function message(text: string, error = false): void {
  const status = element('#status');
  status.textContent = text;
  status.setAttribute('role', error ? 'alert' : 'status');
  status.classList.toggle('error', error);
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The operation failed. Retry.';
}
export function time(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor(whole / 60) % 60;
  const remaining = whole % 60;
  return `${hours ? `${hours}:` : ''}${hours ? String(minutes).padStart(2, '0') : minutes}:${String(remaining).padStart(2, '0')}`;
}
