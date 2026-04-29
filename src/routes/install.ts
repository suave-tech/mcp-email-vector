import { Router } from "express";

export const installRouter: Router = Router();

// Serves the one-click extension install page. The JWT travels in the URL
// fragment (#t=<jwt>) so it never reaches the server — the content script
// reads it client-side, validates via /api/whoami, and saves to chrome.storage.
installRouter.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Connect Extension</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font: 15px/1.6 system-ui, sans-serif; margin: 0; min-height: 100vh;
      display: grid; place-items: center; background: #f9fafb; color: #111; }
    .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px;
      padding: 36px 44px; max-width: 420px; width: 90%; text-align: center;
      box-shadow: 0 1px 3px rgba(0,0,0,.07); }
    .icon { font-size: 36px; margin-bottom: 12px; }
    h1 { margin: 0 0 8px; font-size: 18px; font-weight: 600; }
    p { margin: 0; color: #6b7280; font-size: 14px; }
    .spinner { display: inline-block; width: 32px; height: 32px;
      border: 3px solid #e0e7ff; border-top-color: #4f46e5;
      border-radius: 50%; animation: spin .7s linear infinite; margin-bottom: 16px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .ok { color: #16a34a; }
    .err { color: #dc2626; }
    a { color: #4f46e5; font-size: 13px; display: inline-block; margin-top: 14px; }
  </style>
</head>
<body>
  <div class="card" id="card">
    <div class="spinner" id="spinner"></div>
    <h1 id="heading">Connecting extension…</h1>
    <p id="sub">Please wait a moment.</p>
  </div>
  <script>
    // Fallback: if the content script hasn't updated the DOM after 3s,
    // the extension is probably not installed.
    setTimeout(() => {
      if (document.getElementById('card').dataset.done) return;
      document.getElementById('spinner').style.display = 'none';
      document.getElementById('heading').textContent = 'Extension not detected';
      document.getElementById('sub').innerHTML =
        'Load the unpacked extension in <code>chrome://extensions</code> first, then revisit this link.';
    }, 3000);
  </script>
</body>
</html>`);
});
