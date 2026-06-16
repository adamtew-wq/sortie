// Entry point for the Sortie PWA shell. The engine and UI mount into #app
// in later vertical slices; this file proves the shell installs and renders
// offline. Keep it deterministic and dependency-free — no build step.

(function bootstrap() {
  const root = document.getElementById('app');
  if (root) {
    root.innerHTML =
      '<h1>Sortie</h1>' +
      '<p>Daily sessions on demand.</p>' +
      '<span class="loading">Loading…</span>';
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function registerSW() {
      navigator.serviceWorker.register('./sw.js').catch(function onErr(err) {
        console.warn('Sortie: service worker registration failed', err);
      });
    });
  }
})();
