'use strict';
// splash.html: letters in one by one, then whatever the main process says.
(() => {
  const $ = (id) => document.getElementById(id);
  const title = $('title');
  [...'XÓM GÁY'].forEach((ch, i) => {
    const s = document.createElement('span');
    if (ch === ' ') s.className = 'gap';
    else if (i >= 4) s.className = 'gold';
    s.textContent = ch === ' ' ? '' : ch;
    s.style.animationDelay = `${0.55 + i * 0.07}s`;
    title.append(s);
  });
  $('version').textContent = window.splash.version ? `v${window.splash.version}` : '';
  window.splash.onStatus((text) => { $('status').textContent = text; });
  window.splash.onError((text) => {
    $('error-text').textContent = text;
    $('error').hidden = false;
    $('bar').hidden = true;
    $('status').hidden = true;
  });
  window.splash.onReady(() => {
    $('bar').classList.add('done');
    $('status').textContent = 'Sẵn sàng';
    setTimeout(() => $('card').classList.add('out'), 250);
  });
  $('retry').addEventListener('click', () => {
    $('error').hidden = true; $('bar').hidden = false; $('status').hidden = false;
    $('status').textContent = 'Đang kết nối máy chủ…';
    window.splash.retry();
  });
  $('quit').addEventListener('click', () => window.splash.quit());
})();
