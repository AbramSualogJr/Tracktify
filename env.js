/* Runtime environment shim — loaded before core.js.
   Static hosting (this committed file) → 'local' mode (localStorage only).
   The real backend (server.js) serves its OWN /env.js that sets 'http',
   so the SAME files run cloud-backed when served by the server, and
   offline-demo when served as plain static files. */
window.TT_MODE = 'local';
