export const TRACK_MENU = '[data-testid="audio-text-track-menu"]';

export function checkedSubtitleLabel(menu: Element): string | null {
  const groups = menu.querySelectorAll('[role="menu"]');
  const checked =
    groups.length === 2
      ? groups[1]!.querySelectorAll('[role="menuitemradio"][aria-checked="true"]')
      : [];
  const label = checked.length === 1 ? checked[0]!.getAttribute('aria-label') : null;
  return label && label.length <= 200 ? label : null;
}

interface Probe {
  container: HTMLElement;
  button: HTMLButtonElement;
  observer: MutationObserver;
  timer: ReturnType<typeof setInterval>;
  deadline: number;
  closing: boolean;
  focus: Element | null;
  hidden: Map<
    HTMLElement,
    { visibility: string; priority: string; pointer: string; pointerPriority: string }
  >;
  result: ((label: string) => void) | null;
}

// Katamari mounts track metadata only while this menu is open. Inspect the
// source-identified UI without selecting a radio item or remembering a prior
// episode's language. Own only the menu we open, and restore it on every exit.
export class TrackMenuProbe {
  private current: Probe | null = null;
  private attempted: HTMLElement | null = null;
  get pending(): boolean {
    return this.current !== null;
  }
  start(container: HTMLElement, result: (label: string) => void): boolean {
    if (this.current) return true;
    if (this.attempted === container) return false;
    const buttons = container.querySelectorAll('[data-testid="track-selection-button"]');
    const button = buttons[0];
    if (
      buttons.length !== 1 ||
      !(button instanceof HTMLButtonElement) ||
      button.disabled ||
      button.getAttribute('aria-disabled') === 'true' ||
      button.getAttribute('aria-expanded') !== 'false' ||
      container.querySelector(TRACK_MENU) ||
      container.querySelector('[data-testid="player-controls-root"] [aria-expanded="true"]')
    )
      return false;
    this.attempted = container;
    const observer = new MutationObserver(() => this.check());
    const probe: Probe = {
      container,
      button,
      observer,
      timer: setInterval(() => this.check(), 50),
      deadline: performance.now() + 2000,
      closing: false,
      focus: document.activeElement,
      hidden: new Map(),
      result,
    };
    this.current = probe;
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-expanded', 'aria-checked', 'aria-label'],
    });
    document.addEventListener('pointerdown', this.interrupted, true);
    document.addEventListener('keydown', this.interrupted, true);
    try {
      button.click();
      this.check();
    } catch {
      this.close(probe);
    }
    return true;
  }
  private conceal(probe: Probe, menu: Element): void {
    let popup: Element = menu;
    // Hide the source-inspected popup wrapper as well as its inner menu, so
    // its background cannot flash. Never hide the player or other controls.
    for (
      let parent = menu.parentElement;
      parent && parent !== probe.container;
      parent = parent.parentElement
    ) {
      if (parent.matches('[data-testid="player-controls-root"]')) break;
      if (parent.getAttribute('role') === 'menu') popup = parent;
    }
    if (!(popup instanceof HTMLElement) || probe.hidden.has(popup)) return;
    const style = popup.style;
    probe.hidden.set(popup, {
      visibility: style.getPropertyValue('visibility'),
      priority: style.getPropertyPriority('visibility'),
      pointer: style.getPropertyValue('pointer-events'),
      pointerPriority: style.getPropertyPriority('pointer-events'),
    });
    style.setProperty('visibility', 'hidden', 'important');
    style.setProperty('pointer-events', 'none', 'important');
  }
  private check(): void {
    const probe = this.current;
    if (!probe) return;
    if (
      !probe.container.isConnected ||
      !probe.button.isConnected ||
      !probe.container.contains(probe.button)
    ) {
      this.cleanup(probe);
      return;
    }
    const menus = probe.container.querySelectorAll(TRACK_MENU);
    for (const menu of menus) this.conceal(probe, menu);
    if (probe.closing) {
      if (!menus.length || performance.now() >= probe.deadline) this.cleanup(probe);
      return;
    }
    const label = menus.length === 1 ? checkedSubtitleLabel(menus[0]!) : null;
    if (label) {
      const result = probe.result;
      probe.result = null;
      result?.(label);
      this.close(probe);
    } else if (performance.now() >= probe.deadline) this.close(probe);
  }
  private close(probe: Probe): void {
    if (probe !== this.current || probe.closing) return;
    probe.result = null;
    probe.closing = true;
    probe.deadline = performance.now() + 500;
    // Only reverse our own opening. Never click an item or an unrelated/new
    // button, and never close a menu that the user had already opened.
    if (
      probe.button.isConnected &&
      probe.container.contains(probe.button) &&
      probe.button.getAttribute('aria-expanded') === 'true'
    ) {
      try {
        probe.button.click();
      } catch {
        /* Restore styles at the bounded deadline. */
      }
    }
    this.check();
  }
  private cleanup(probe: Probe): void {
    if (probe !== this.current) return;
    probe.observer.disconnect();
    clearInterval(probe.timer);
    document.removeEventListener('pointerdown', this.interrupted, true);
    document.removeEventListener('keydown', this.interrupted, true);
    const focusedMenu = [...probe.hidden.keys()].some((popup) =>
      popup.contains(document.activeElement),
    );
    for (const [popup, saved] of probe.hidden) {
      if (
        popup.style.getPropertyValue('visibility') === 'hidden' &&
        popup.style.getPropertyPriority('visibility') === 'important'
      )
        popup.style.setProperty('visibility', saved.visibility, saved.priority);
      if (
        popup.style.getPropertyValue('pointer-events') === 'none' &&
        popup.style.getPropertyPriority('pointer-events') === 'important'
      )
        popup.style.setProperty('pointer-events', saved.pointer, saved.pointerPriority);
    }
    this.current = null;
    if (focusedMenu && probe.focus instanceof HTMLElement && probe.focus.isConnected)
      probe.focus.focus({ preventScroll: true });
  }
  private interrupted = (event: Event): void => {
    if (event.isTrusted) this.cancel();
  };
  cancel(): void {
    if (this.current) this.close(this.current);
  }
  reset(): void {
    this.cancel();
    this.attempted = null;
  }
  dispose(): void {
    this.reset();
    // Teardown must release our observers/styles even if the page disappears
    // before an asynchronous player menu-close commit.
    if (this.current) this.cleanup(this.current);
  }
}
