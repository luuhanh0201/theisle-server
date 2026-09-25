'use strict';
// tai.html: the launcher downloads, from /tai/version.json (scripts/release-launcher.sh).
(async () => {
  const $ = (id) => document.getElementById(id);
  const mine = /Windows/i.test(navigator.userAgent) ? 'win' : /Linux|X11/i.test(navigator.userAgent) && !/Android/i.test(navigator.userAgent) ? 'linux' : null;
  if (mine) { $(`tag-${mine}`).hidden = false; $(`dl-${mine}`).classList.add('mine'); }
  let v;
  try {
    const r = await fetch('/tai/version.json', { cache: 'no-cache' });
    if (!r.ok) return;
    v = await r.json();
  } catch { return; }
  const mb = (n) => `${Math.round(n / 1048576)} MB`;
  $('version').textContent = `Phiên bản ${v.version}${v.date ? ` · ${new Date(v.date).toLocaleDateString('vi-VN')}` : ''}`;
  for (const os of ['win', 'linux']) {
    const f = v[os === 'win' ? 'windows' : 'linux'];
    if (!f || !f.file) continue;
    const b = $(`btn-${os}`);
    b.href = `/tai/${encodeURIComponent(f.file)}`;
    b.classList.remove('off');
    b.textContent = `Tải cho ${os === 'win' ? 'Windows' : 'Linux'}${f.size ? ` (${mb(f.size)})` : ''}`;
  }
})();
