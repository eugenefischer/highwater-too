/**
 * Tooltips on the page's controls (Highland's words), shown after a moment's hover just below the
 * control, kept inside the window. Our own, as a webview's title tooltips don't always show.
 * Delegated, so controls made later (the sidebar's rows and their buttons) have them too.
 */
export function installTooltips(): void {
  const tip = document.createElement("div");
  tip.id = "hl-tip";
  tip.hidden = true;
  tip.setAttribute("role", "tooltip");
  document.body.append(tip);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hide = () => {
    clearTimeout(timer);
    tip.hidden = true;
  };
  // Delegated, so controls made later (the sidebar's rows and their buttons) have them too.
  let over: HTMLElement | null = null;
  document.addEventListener("mouseover", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
    if (el === over) return;
    over = el;
    hide();
    if (!el) return;
    timer = setTimeout(() => {
      if (!el.isConnected || !el.dataset.tip) return;
      tip.textContent = el.dataset.tip;
      tip.hidden = false;
      const r = el.getBoundingClientRect();
      const w = tip.offsetWidth;
      // Below the control, or above it near the foot of the window (the sidebar's buttons).
      const below = r.bottom + 4 + tip.offsetHeight <= window.innerHeight - 4;
      tip.style.top = `${Math.round(below ? r.bottom + 4 : r.top - 4 - tip.offsetHeight)}px`;
      tip.style.left = `${Math.round(Math.max(4, Math.min(window.innerWidth - w - 4, r.left + r.width / 2 - w / 2)))}px`;
    }, 500);
  });
  document.addEventListener("mousedown", hide, true);
  window.addEventListener("blur", hide);
}
