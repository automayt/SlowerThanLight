/**
 * Who gets the Esc key. Screens and panels that use it (closing a panel, cancelling an aim, leaving a screen) call
 * escHandled() when they act on it; an Esc that nobody handled opens the options (see options.ts). Each press starts
 * unhandled.
 */
let handled = false;

/** Call from an Esc handler that did something with the key, so the options stay shut. */
export function escHandled(): void {
  handled = true;
}

/** A new Esc press: nobody has handled it yet. */
export function escPressed(): void {
  handled = false;
}

export function wasEscHandled(): boolean {
  return handled;
}
