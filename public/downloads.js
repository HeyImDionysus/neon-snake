(function initializeWallpaperDownloads(root) {
  "use strict";

  const links = [...document.querySelectorAll("[data-wallpaper-download]")];
  const timers = new WeakMap();

  links.forEach((link) => {
    const status = document.getElementById(link.getAttribute("aria-describedby"));
    if (!status) return;
    link.addEventListener("click", () => {
      const previous = timers.get(link);
      if (previous) root.clearTimeout(previous);
      link.closest(".download-platform")?.classList.add("download-started");
      status.textContent = `${link.dataset.wallpaperDownload.toUpperCase()} DOWNLOAD STARTED · CHECK YOUR BROWSER DOWNLOADS`;
      const timer = root.setTimeout(() => {
        status.textContent = "NO DOWNLOAD VISIBLE? TAP THE DOWNLOAD BUTTON AGAIN";
        link.closest(".download-platform")?.classList.remove("download-started");
        timers.delete(link);
      }, 8_000);
      timers.set(link, timer);
    });
  });
})(globalThis);
