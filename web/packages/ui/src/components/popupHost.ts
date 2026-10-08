/**
 * Where a control's floating list or picker goes: into the open <dialog> the control sits in, else <body>.
 * A modal <dialog> (showModal: the player site's Túi đồ and Cửa hàng boxes) is drawn in the browser's top layer,
 * above the whole page whatever its z-index, so a list put in <body> opened under the box, unseen (owner, 2026-10-08).
 */
export function popupHost(anchor: Element | null): Element {
  return anchor?.closest('dialog[open]') ?? document.body;
}
