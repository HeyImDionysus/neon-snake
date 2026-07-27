(function initializeSiteShell(root) {
  "use strict";

  const header = root.document?.querySelector(".product-header");
  const navigation = header?.querySelector(".site-nav");
  const toggle = header?.querySelector(".site-menu-toggle");
  if (!header || !navigation || !toggle) return;

  const mobileQuery = root.matchMedia("(max-width: 820px)");
  const sectionLinks = [...navigation.querySelectorAll('a[href^="#"]')]
    .map((link) => ({
      link,
      section: root.document.querySelector(link.getAttribute("href")),
    }))
    .filter(({ section }) => section);
  let open = false;
  let scrollFrame = 0;

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

  function syncScrollState() {
    scrollFrame = 0;
    header.classList.toggle("is-condensed", root.scrollY > 24);
    if (sectionLinks.length < 2) return;
    const activeLine = root.scrollY + root.innerHeight * .32;
    let active = sectionLinks[0];
    sectionLinks.forEach((candidate) => {
      if (candidate.section.offsetTop <= activeLine) active = candidate;
    });
    sectionLinks.forEach(({ link }) => {
      if (link === active.link) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function scheduleScrollSync() {
    if (scrollFrame) return;
    scrollFrame = root.requestAnimationFrame(syncScrollState);
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
  root.addEventListener("scroll", scheduleScrollSync, { passive: true });
  root.addEventListener("pagehide", () => {
    mobileQuery.removeEventListener?.("change", syncViewport);
    root.removeEventListener("scroll", scheduleScrollSync);
    if (scrollFrame) root.cancelAnimationFrame(scrollFrame);
  }, { once: true });

  root.document.documentElement.classList.add("site-shell-ready");
  syncViewport();
  syncScrollState();
})(globalThis);
