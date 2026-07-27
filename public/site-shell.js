(function initializeSiteShell(root) {
  "use strict";

  const header = root.document?.querySelector(".product-header");
  const navigation = header?.querySelector(".site-nav");
  const toggle = header?.querySelector(".site-menu-toggle");
  if (!header || !navigation || !toggle) return;

  const mobileQuery = root.matchMedia("(max-width: 820px)");
  let open = false;

  function setOpen(nextOpen, { restoreFocus = false } = {}) {
    open = Boolean(nextOpen) && mobileQuery.matches;
    root.document.body.classList.toggle("site-menu-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    navigation.inert = mobileQuery.matches && !open;
    if (mobileQuery.matches) navigation.setAttribute("aria-hidden", String(!open));
    else navigation.removeAttribute("aria-hidden");

    if (open) {
      navigation.querySelector("a")?.focus({ preventScroll: true });
    } else if (restoreFocus) {
      toggle.focus({ preventScroll: true });
    }
  }

  function syncViewport() {
    if (!mobileQuery.matches) {
      open = false;
      root.document.body.classList.remove("site-menu-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open navigation");
      navigation.inert = false;
      navigation.removeAttribute("aria-hidden");
      return;
    }
    setOpen(false);
  }

  toggle.addEventListener("click", () => setOpen(!open, { restoreFocus: open }));
  navigation.addEventListener("click", (event) => {
    if (event.target.closest("a")) setOpen(false);
  });
  root.document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && open) setOpen(false, { restoreFocus: true });
  });
  root.document.addEventListener("pointerdown", (event) => {
    if (open && !header.contains(event.target)) setOpen(false);
  });
  mobileQuery.addEventListener?.("change", syncViewport);
  root.addEventListener("pagehide", () => {
    mobileQuery.removeEventListener?.("change", syncViewport);
  }, { once: true });

  root.document.documentElement.classList.add("site-shell-ready");
  syncViewport();
})(globalThis);
