"use strict";

let promptInstall;
function showInstall() {
  const control = document.querySelector("#install-control");
  if (control) control.hidden = !promptInstall;
}
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  promptInstall = event;
  showInstall();
});
window.addEventListener("appinstalled", () => {
  promptInstall = null;
  showInstall();
});
window.addEventListener("toeic-settings-rendered", showInstall);
document.addEventListener("click", async event => {
  if (!event.target.closest('[data-action="install"]') || !promptInstall) return;
  const prompt = promptInstall;
  promptInstall = null;
  showInstall();
  await prompt.prompt();
});
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register("./sw.js").catch(error => console.warn("無法啟用離線介面", error));
}
