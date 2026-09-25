/* Vector 3Dit — boot. */
(function () {
  'use strict';
  const V3D = globalThis.V3D;
  const start = () => {
    const root = document.getElementById('app');
    try {
      const app = new V3D.App();
      V3D.app = app;
      app.init(root);
    } catch (e) {
      console.error(e);
      root.innerHTML = '<div style="padding:40px;font:15px system-ui;color:#eee">Vector 3Dit could not start: ' + V3D.U.esc(e.message) + '</div>';
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
