const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const inr = n => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n);
const SCOPES = ['balance', 'transactions'];

let custToken = null, APPS = {}, consents = {}, tokens = {}, results = {}, notes = {}, timer = null, activePage = 'consents';

/* ---------- API helper ---------- */
async function api(method, url, token, body) {
  const res = await fetch(url, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  let data = {};
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}
const decode = t => JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
const clr = id => { SCOPES.forEach(s => delete results[id + s]); delete notes[id]; };

/* ---------- Rendering ---------- */
function renderConsent() {
  let h = '<tr><th>Application</th>' + SCOPES.map(s => `<th class="c">${s}</th>`).join('') + '</tr>';
  Object.entries(APPS).forEach(([id, a]) => {
    h += `<tr><td>${a.name}</td>` + SCOPES.map(s => a.scopes.includes(s)
      ? `<td class="c"><input type="checkbox" class="switch" data-app="${id}" data-scope="${s}" ${(consents[id] || []).includes(s) ? 'checked' : ''} aria-label="${a.name} may read ${s}"></td>`
      : '<td class="c mono">not requested</td>').join('') + '</tr>';
  });
  $('consentTbl').innerHTML = h;
}

function renderNavigation() {
  const pages = [
    ['consents', 'Consent manager'],
    ...Object.entries(APPS).map(([id, app]) => [id, app.name]),
    ['audit', 'Audit log']
  ];
  $('pageNav').innerHTML = pages.map(([id, label]) =>
    `<a href="#${id}" data-page="${id}">${esc(label)}</a>`).join('');
  renderPage();
}

function renderPage() {
  if (!custToken) return;
  const page = location.hash.slice(1);
  const validPages = ['consents', 'audit', ...Object.keys(APPS)];
  activePage = validPages.includes(page) ? page : 'consents';
  if (!validPages.includes(page)) history.replaceState(null, '', '#consents');

  $('consentsPage').classList.toggle('hide', activePage !== 'consents');
  $('activityPage').classList.toggle('hide', !APPS[activePage]);
  $('auditPage').classList.toggle('hide', activePage !== 'audit');
  $('pageNav').querySelectorAll('a').forEach(link => {
    if (link.dataset.page === activePage) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  renderActivity();
}

function renderPending(list) {
  $('pending').innerHTML = list.map(r => `
    <div class="request">
      <p><b>${esc(r.appName)}</b> wants to read: <b>${r.scopes.join(', ')}</b></p>
      <div class="row">
        <button data-act="allow" data-id="${r.id}">Allow</button>
        <button class="danger" data-act="deny" data-id="${r.id}">Deny</button>
      </div>
    </div>`).join('');
}

function view(scope, r) {
  if (r.status !== 200) return `<p class="err"><b>${r.status}</b> ${esc(r.data.error)}</p>`;
  if (scope === 'balance') return `<p>Account ${r.data.account}</p><div class="big">${inr(r.data.amount)}</div>`;
  const spent = r.data.filter(x => x.amt < 0).reduce((s, x) => s + x.amt, 0);
  return '<div class="wrap"><table><tr><th>Date</th><th>Description</th><th>Amount</th></tr>' +
    r.data.map(x => `<tr><td>${x.date}</td><td>${esc(x.desc)}</td><td>${inr(x.amt)}</td></tr>`).join('') +
    `</table></div><p>Total spent: <b>${inr(-spent)}</b></p>`;
}

function renderActivity() {
  const app = APPS[activePage];
  if (!app) return;
  const t = tokens[activePage];
  let h = `<section class="card"><h2>${esc(app.name)}</h2><p class="mono">Requests: ${app.scopes.map(esc).join(', ')}</p><div class="row">`;
  h += `<button data-act="connect" data-app="${activePage}">Connect to bank</button>`;
  if (t) {
    h += app.scopes.map(s => `<button class="ghost" data-act="fetch" data-app="${activePage}" data-scope="${s}">Get ${esc(s)}</button>`).join('');
    h += `<button class="ghost" data-act="drop" data-app="${activePage}">Disconnect</button>`;
  }
  h += '</div>';
  if (t) h += `<p><span class="pill ok">Token issued</span></p><pre>${esc(JSON.stringify(decode(t), null, 1))}</pre>`;
  else h += `<p><span class="pill bad">${notes[activePage] ? esc(notes[activePage]) : 'Not connected'}</span></p>`;
  h += '<div>' + app.scopes.map(s => results[activePage + s] || '').join('') + '</div></section>';
  $('activityContent').innerHTML = h;
}

/* ---------- Data refresh ---------- */
async function refresh() {
  if (!custToken) return;
  const [c, p, l] = await Promise.all([
    api('GET', '/api/consents', custToken),
    api('GET', '/api/requests', custToken),
    api('GET', '/api/logs', custToken)
  ]);
  if (c.status === 401) return logout();
  consents = c.data;
  renderPending(p.data);
  renderConsent();
  renderActivity();
  $('log').innerHTML = l.data.map(x =>
    `<div class="${x.ok ? '' : 'err'}">${new Date(x.time).toLocaleTimeString()} ${esc(x.msg)}</div>`).join('');
}

function logout() {
  custToken = null; tokens = {}; results = {}; notes = {};
  clearInterval(timer);
  $('app').classList.add('hide');
  $('loginBox').classList.remove('hide');
}

/* ---------- Events ---------- */
$('loginBtn').onclick = async () => {
  const r = await api('POST', '/api/login', null, { username: $('u').value.trim(), password: $('p').value });
  if (r.status !== 200) { $('loginErr').textContent = r.data.error; return; }
  custToken = r.data.token;
  $('loginErr').textContent = '';
  APPS = (await api('GET', '/api/apps')).data;
  renderNavigation();
  $('loginBox').classList.add('hide');
  $('app').classList.remove('hide');
  await refresh();
  timer = setInterval(refresh, 2000);
};
$('logoutBtn').onclick = logout;
$('pageNav').onclick = e => {
  if (e.target.closest('a')) renderPage();
};
window.addEventListener('hashchange', renderPage);
$('clearLog').onclick = async () => { await api('DELETE', '/api/logs', custToken); refresh(); };

$('consentTbl').onchange = async e => {
  const el = e.target;
  if (!el.dataset.app) return;
  await api('PUT', '/api/consents', custToken, { app: el.dataset.app, scope: el.dataset.scope, granted: el.checked });
  refresh();
};

$('pending').onclick = async e => {
  const b = e.target.closest('button');
  if (!b) return;
  await api('POST', `/api/requests/${b.dataset.id}/decision`, custToken, { allow: b.dataset.act === 'allow' });
  refresh();
};

async function connect(id) {
  clr(id); delete tokens[id];
  notes[id] = 'Waiting for the customer to allow or deny…';
  renderActivity();
  const { data } = await api('POST', '/api/authorize', null, { app: id });
  refresh();
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const s = (await api('GET', '/api/authorize/' + data.requestId)).data;
    if (s.status === 'approved') { tokens[id] = s.token; delete notes[id]; break; }
    if (s.status === 'denied') { notes[id] = 'Customer denied access'; break; }
    if (i === 59) notes[id] = 'Request timed out';
  }
  renderActivity(); refresh();
}

$('activityContent').onclick = async e => {
  const b = e.target.closest('button');
  if (!b) return;
  const id = b.dataset.app;
  if (b.dataset.act === 'connect') return connect(id);
  if (b.dataset.act === 'drop') { delete tokens[id]; clr(id); }
  if (b.dataset.act === 'fetch') {
    const r = await api('GET', '/api/data/' + b.dataset.scope, tokens[id]);
    results[id + b.dataset.scope] = view(b.dataset.scope, r);
  }
  renderActivity(); refresh();
};
