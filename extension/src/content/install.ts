// Content script — only injected on http://localhost:3000/api/extension/install
// Reads the JWT from the URL fragment, validates it, and saves it to storage.
// Updates the page DOM so the user sees success or error without touching the options page.

(async () => {
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get("t");
  const apiUrl = location.origin; // http://localhost:3000

  function render(ok: boolean, line1: string, line2: string) {
    const card = document.getElementById("card");
    if (card) card.dataset.done = "1";
    const spinner = document.getElementById("spinner");
    if (spinner) spinner.style.display = "none";
    const icon = document.createElement("div");
    icon.className = "icon";
    icon.textContent = ok ? "✓" : "✗";
    icon.style.color = ok ? "#16a34a" : "#dc2626";
    const heading = document.getElementById("heading");
    if (heading) {
      heading.parentElement?.insertBefore(icon, heading);
      heading.textContent = line1;
    }
    const sub = document.getElementById("sub");
    if (sub) {
      sub.textContent = line2;
      if (ok) {
        const a = document.createElement("a");
        a.href = "#";
        a.textContent = "Open Email Search →";
        a.onclick = (e) => {
          e.preventDefault();
          window.close();
        };
        sub.parentElement?.appendChild(a);
      }
    }
  }

  if (!token) {
    render(
      false,
      "No token in URL",
      "The install link appears to be malformed. Re-run pnpm run create-user.",
    );
    return;
  }

  try {
    const res = await fetch(`${apiUrl}/api/whoami`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Token rejected (${res.status})`);
    const { email, userId } = (await res.json()) as { email?: string; userId: string };
    await chrome.storage.local.set({ apiUrl, token });
    render(true, "Extension connected", `Signed in as ${email ?? userId}`);
  } catch (err) {
    render(false, "Connection failed", err instanceof Error ? err.message : String(err));
  }
})();
