/** Serialized by Chrome. Keep this function self-contained: no imports or closures. */
export function readPageSelection(): { url: string; title: string; selection: string } {
  let focused = document.activeElement;
  while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
  const formControlFocused = focused?.tagName === 'INPUT' || focused?.tagName === 'TEXTAREA';
  return {
    url: window.location.href.slice(0, 2049),
    title: document.title.slice(0, 240),
    // Main document only; deliberately does not read password/input fields or frames.
    selection: (formControlFocused ? '' : (window.getSelection()?.toString() ?? ''))
      .slice(0, 2000)
      .trim(),
  };
}
