import { errorMessage } from './model.ts';

export function element<T extends HTMLElement>(selector: string): T {
  const result = document.querySelector<T>(selector);
  if (!result) throw new Error(`Missing interface element: ${selector}`);
  return result;
}

export function setStatus(message: string, isError = false): void {
  const status = element('#status');
  status.textContent = message;
  status.classList.toggle('is-error', isError);
  status.setAttribute('role', isError ? 'alert' : 'status');
}

export function showError(error: unknown): void {
  setStatus(errorMessage(error), true);
}

export function confirmAction(
  title: string,
  description: string,
  action: string,
): Promise<boolean> {
  const dialog = element<HTMLDialogElement>('#confirm-dialog');
  element('#confirm-title').textContent = title;
  element('#confirm-description').textContent = description;
  element('#confirm-action').textContent = action;
  dialog.returnValue = '';
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), {
      once: true,
    });
    dialog.showModal();
    element<HTMLButtonElement>('#cancel-action').focus();
  });
}
