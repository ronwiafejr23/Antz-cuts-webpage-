/* app.js — I load this on every page. I register the service worker so Antz
   Cuts can be installed like an app, and I show an "Install app" button in
   the nav when the browser allows it (Chrome / Edge / Android). On iPhone,
   customers use Share > Add to Home Screen. */

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => { /* not served by my server.js: I skip it */ });
  });
}

let installPrompt = null;

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
  const links = document.querySelector(".nav-links");
  if (!links || document.getElementById("install-app")) return;
  const li = document.createElement("li");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "install-app";
  btn.className = "install-btn";
  btn.textContent = "Install app";
  btn.addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    li.remove();
  });
  li.appendChild(btn);
  links.appendChild(li);
});

window.addEventListener("appinstalled", () => {
  const btn = document.getElementById("install-app");
  if (btn) btn.parentElement.remove();
});
