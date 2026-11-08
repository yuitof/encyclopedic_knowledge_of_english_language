// This adapter changes presentation and focus semantics, never indexing or ranking.
function prepareVisibleSearch() {
  const skip = document.querySelector<HTMLAnchorElement>(".skip-link")
  const main = document.querySelector<HTMLElement>("#main-content")
  const skipToArticle = (event: MouseEvent) => { event.preventDefault(); event.stopImmediatePropagation(); main?.focus(); main?.scrollIntoView() }
  skip?.addEventListener("click", skipToArticle, true)
  window.addCleanup(() => skip?.removeEventListener("click", skipToArticle, true))
  const navigation = document.querySelector<HTMLDetailsElement>(".navigation-panel")
  if (navigation && window.matchMedia("(max-width: 800px)").matches) navigation.open = false
  const input = document.querySelector<HTMLInputElement>(".header-search .search-bar")
  const button = document.querySelector<HTMLButtonElement>(".header-search .search-button")
  const container = document.querySelector<HTMLElement>(".header-search .search-container")
  if (!input || !button || !container || input.dataset.visibleSearch) return
  input.dataset.visibleSearch = "true"
  input.placeholder = "Search the encyclopedia"
  input.setAttribute("aria-label", "Search the encyclopedia")
  input.setAttribute("aria-autocomplete", "list")
  input.setAttribute("aria-controls", "encyclopedia-search-results")
  input.setAttribute("aria-expanded", "false")
  button.tabIndex = -1
  const focus = () => { if (!container.classList.contains("active")) button.click() }
  const escape = (event: KeyboardEvent) => {
    if (event.key === "Tab") { event.stopImmediatePropagation(); return }
    if (event.key === "Escape") {
      input.value = ""
      input.dispatchEvent(new Event("input"))
      container.classList.remove("active")
      input.setAttribute("aria-expanded", "false")
      input.blur()
    }
  }
  input.addEventListener("focus", focus)
  input.addEventListener("keydown", escape, true)
  const observer = new MutationObserver(() => {
    const results = document.querySelector<HTMLElement>(".header-search .results-container")
    if (results) {
      if (!results.dataset.visibleResults) {
        results.dataset.visibleResults = "true"
        if (document.activeElement === input) {
          focus()
          if (input.value) input.dispatchEvent(new Event("input"))
        }
      }
      results.id = "encyclopedia-search-results"
      // Results are navigable links, not ARIA options: retain native link semantics.
      results.removeAttribute("role")
      results.setAttribute("aria-live", "polite")
    }
    input.setAttribute("aria-expanded", String(container.classList.contains("active") && !!input.value))
  })
  observer.observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] })
  window.addCleanup(() => { input.removeEventListener("focus", focus); input.removeEventListener("keydown", escape, true); observer.disconnect() })
}
document.addEventListener("nav", prepareVisibleSearch)
document.addEventListener("render", prepareVisibleSearch)
