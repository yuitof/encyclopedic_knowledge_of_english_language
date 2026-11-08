function prepareAppearance() {
  const panels = document.querySelectorAll<HTMLElement>(".appearance-panel");
  let preferences: { text: string; width: string; color: string } = {
    text: "standard",
    width: "standard",
    color: "automatic",
  };
  const allowed = {
    text: ["small", "standard", "large"],
    width: ["standard", "wide"],
    color: ["automatic", "light", "dark"],
  };
  try {
    const stored = JSON.parse(
      localStorage.getItem("reading-appearance") ?? "{}",
    );
    if (stored && typeof stored === "object" && !Array.isArray(stored))
      for (const key of ["text", "width", "color"] as const)
        if (allowed[key].includes(stored[key])) preferences[key] = stored[key];
  } catch {}
  const media = matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    document.documentElement.dataset.text = preferences.text;
    document.documentElement.dataset.width = preferences.width;
    document.documentElement.dataset.color = preferences.color;
    document.documentElement.setAttribute(
      "saved-theme",
      preferences.color === "automatic"
        ? media.matches
          ? "dark"
          : "light"
        : preferences.color,
    );
    for (const panel of panels)
      for (const input of panel.querySelectorAll<HTMLInputElement>("input")) {
        input.checked =
          preferences[
            input.name.replace("appearance-", "") as keyof typeof preferences
          ] === input.value;
      }
  };
  const change = (event: Event) => {
    const input = event.target as HTMLInputElement,
      key = input.name.replace("appearance-", "") as keyof typeof preferences;
    if (
      !["text", "width", "color"].includes(key) ||
      !allowed[key].includes(input.value)
    )
      return;
    preferences[key] = input.value;
    try {
      localStorage.setItem("reading-appearance", JSON.stringify(preferences));
    } catch {}
    apply();
    document.dispatchEvent(
      new CustomEvent("themechange", {
        detail: { theme: document.documentElement.getAttribute("saved-theme") },
      }),
    );
  };
  for (const panel of panels) panel.addEventListener("change", change);
  media.addEventListener("change", apply);
  apply();
  window.addCleanup(() => {
    for (const panel of panels) panel.removeEventListener("change", change);
    media.removeEventListener("change", apply);
  });
}
document.addEventListener("nav", prepareAppearance);
document.addEventListener("render", prepareAppearance);
