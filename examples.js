(() => {
  const pages = [...document.querySelectorAll(".exam-page")];
  const links = [...document.querySelectorAll("[data-page-link]")];
  const progress = document.getElementById("readingProgress");
  const outline = document.querySelector(".document-outline details");
  const narrow = window.matchMedia("(max-width: 950px)");
  let current = null;
  let framePending = false;

  function markCurrentPage() {
    framePending = false;
    const readingLine = Math.min(window.innerHeight * .4, 300);
    let closest = pages[0];
    for (const page of pages) {
      if (page.getBoundingClientRect().top <= readingLine) closest = page;
      else break;
    }
    const number = closest.dataset.page;
    if (number === current) return;
    current = number;
    progress.textContent = `หน้า ${number} / ${pages.length}`;
    links.forEach(link => {
      if (link.dataset.pageLink === number) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function queueUpdate() {
    if (framePending) return;
    framePending = true;
    window.requestAnimationFrame(markCurrentPage);
  }

  outline.open = !narrow.matches;
  narrow.addEventListener("change", event => { outline.open = !event.matches; });
  links.forEach(link => link.addEventListener("click", () => {
    if (narrow.matches) outline.open = false;
  }));
  window.addEventListener("scroll", queueUpdate, { passive: true });
  window.addEventListener("resize", queueUpdate, { passive: true });
  window.addEventListener("hashchange", queueUpdate);
  markCurrentPage();
})();
