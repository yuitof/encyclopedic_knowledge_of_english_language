{
  const allowed = {
    text: ["small", "standard", "large"],
    width: ["standard", "wide"],
    color: ["automatic", "light", "dark"],
  };
  let stored: Record<string, unknown> = {};
  try {
    const value = JSON.parse(
      localStorage.getItem("reading-appearance") ?? "{}",
    );
    if (value && typeof value === "object" && !Array.isArray(value))
      stored = value;
  } catch {}
  for (const key of ["text", "width", "color"] as const) {
    const fallback = key === "color" ? "automatic" : "standard";
    document.documentElement.dataset[key] = allowed[key].includes(
      stored[key] as string,
    )
      ? String(stored[key])
      : fallback;
  }
  const color = document.documentElement.dataset.color;
  document.documentElement.setAttribute(
    "saved-theme",
    color === "automatic"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : color!,
  );
}
