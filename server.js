const express = require('express');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SECRET = process.env.JWT_SECRET || 'demo-bank-signing-secret';
const PORT = process.env.PORT || 3000;

/* ---------- Simulated banking data ---------- */
const USER = { username: 'asha', password: 'bank123' };
const DATA = {
  balance: { account: 'XXXX-4821', currency: 'INR', amount: 48250.75 },
  transactions: [
    { date: '2026-10-22', desc: 'Grocery Mart', amt: -2150.5 },
    { date: '2026-10-21', desc: 'Salary credit', amt: 65000 },
    { date: '2026-10-20', desc: 'Metro card top-up', amt: -500 },
    { date: '2026-10-18', desc: 'Electricity bill', amt: -1840.25 },
    { date: '2026-10-17', desc: 'Cafe Mocha', amt: -390 },
    { date: '2026-10-15', desc: 'Online course', amt: -3999 },
    { date: '2026-10-12', desc: 'Pharmacy', amt: -720 }
  ]
};

/* ---------- Registered apps and what they ask for ---------- */
const APPS = {
  expense: { name: 'Expense Tracker', scopes: ['transactions'] },
  balance: { name: 'Balance Checker', scopes: ['balance'] },
  dash: { name: 'Financial Dashboard', scopes: ['balance', 'transactions'] }
};

/* ---------- In-memory stores ---------- */
const consents = { expense: [], balance: [], dash: [] }; // granted scopes per app
const requests = {};                                      // access requests
const logs = [];
let reqSeq = 1;

const log = (msg, ok = true) => {
  logs.unshift({ time: new Date().toISOString(), msg, ok });
  if (logs.length > 100) logs.pop();
};

/* ---------- Middleware ---------- */
function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

// Customer authentication: only a customer JWT passes
function requireCustomer(req, res, next) {
  try {
    const p = jwt.verify(bearer(req), SECRET);
    if (p.role !== 'customer') throw new Error('not a customer token');
    req.user = p;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Customer login required' });
  }
}

// App authorization: valid token + scope in token + live customer consent
function requireScope(scope) {
  return (req, res, next) => {
    let p;
    try {
      p = jwt.verify(bearer(req), SECRET);
    } catch (e) {
      const why = e.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid or missing token';
      log(`GET /api/data/${scope} → 401 (${why})`, false);
      return res.status(401).json({ error: why });
    }
    const name = APPS[p.app] ? APPS[p.app].name : 'Unknown app';
    if (p.role !== 'app' || !(p.scope || []).includes(scope)) {
      log(`GET /api/data/${scope} by ${name} → 403 (scope not in token)`, false);
      return res.status(403).json({ error: `Token scope does not include "${scope}"` });
    }
    if (!(consents[p.app] || []).includes(scope)) {
      log(`GET /api/data/${scope} by ${name} → 403 (consent withdrawn)`, false);
      return res.status(403).json({ error: `Customer consent for "${scope}" was withdrawn` });
    }
    log(`GET /api/data/${scope} by ${name} → 200`);
    next();
  };
}

/* ---------- Auth ---------- */
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username !== USER.username || password !== USER.password) {
    log('Customer login failed', false);
    return res.status(401).json({ error: 'Wrong username or password' });
  }
  const token = jwt.sign({ sub: username, role: 'customer' }, SECRET, { expiresIn: '1h' });
  log('Customer signed in, JWT issued');
  res.json({ token });
});

/* ---------- Public app list ---------- */
app.get('/api/apps', (req, res) => res.json(APPS));

/* ---------- Customer: consent management ---------- */
app.get('/api/consents', requireCustomer, (req, res) => res.json(consents));

app.put('/api/consents', requireCustomer, (req, res) => {
  const { app: id, scope, granted } = req.body || {};
  if (!APPS[id] || !APPS[id].scopes.includes(scope)) return res.status(400).json({ error: 'Unknown app or scope' });
  const set = new Set(consents[id]);
  granted ? set.add(scope) : set.delete(scope);
  consents[id] = [...set];
  log(`Consent ${granted ? 'granted' : 'withdrawn'}: ${APPS[id].name} / ${scope}`, !!granted);
  res.json(consents);
});

/* ---------- Customer: pending access requests ---------- */
app.get('/api/requests', requireCustomer, (req, res) =>
  res.json(Object.values(requests).filter(r => r.status === 'pending')));

app.post('/api/requests/:id/decision', requireCustomer, (req, res) => {
  const r = requests[req.params.id];
  if (!r || r.status !== 'pending') return res.status(404).json({ error: 'Request not found' });
  if (req.body.allow) {
    consents[r.app] = [...new Set([...consents[r.app], ...r.scopes])];
    r.token = jwt.sign({ sub: USER.username, role: 'app', app: r.app, scope: r.scopes }, SECRET, { expiresIn: '5m' });
    r.status = 'approved';
    log(`Customer approved ${APPS[r.app].name}: ${r.scopes.join(', ')}`);
  } else {
    r.status = 'denied';
    log(`Customer denied ${APPS[r.app].name}`, false);
  }
  res.json({ status: r.status });
});

/* ---------- App: ask for access and collect the token ---------- */
app.post('/api/authorize', (req, res) => {
  const a = APPS[(req.body || {}).app];
  if (!a) return res.status(400).json({ error: 'Unknown app' });
  const id = String(reqSeq++);
  requests[id] = { id, app: req.body.app, appName: a.name, scopes: a.scopes, status: 'pending' };
  log(`${a.name} requested access to: ${a.scopes.join(', ')}`);
  res.json({ requestId: id });
});

app.get('/api/authorize/:id', (req, res) => {
  const r = requests[req.params.id];
  if (!r) return res.status(404).json({ error: 'Request not found' });
  res.json({ status: r.status, token: r.status === 'approved' ? r.token : undefined });
});

/* ---------- Protected data APIs ---------- */
app.get('/api/data/balance', requireScope('balance'), (req, res) => res.json(DATA.balance));
app.get('/api/data/transactions', requireScope('transactions'), (req, res) => res.json(DATA.transactions));

/* ---------- Audit log ---------- */
app.get('/api/logs', requireCustomer, (req, res) => res.json(logs));
app.delete('/api/logs', requireCustomer, (req, res) => { logs.length = 0; res.json([]); });

app.listen(PORT, () => console.log(`Banking Data Sharing Simulator running at http://localhost:${PORT}`));
