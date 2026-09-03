// Vokabel Race — Firestore transport shared by the student app and the projector.
// Project vocabtrainer-c1499. Config values are public by design; access is
// controlled by firestore.rules + anonymous auth.
//
// Trust model: the PROJECTOR is the referee. The session document carries only
// definitions (never the English answers), so a phone cannot read the answer.
// A phone writes what it typed into its own player doc; the projector validates
// it against its in-memory deck and awards or resets points.

const V = '10.12.2';
const CFG = {
  apiKey: 'AIzaSyAPlZwBDAe1219atud4ZOuovViAQTykjLk',
  authDomain: 'vocabtrainer-c1499.firebaseapp.com',
  projectId: 'vocabtrainer-c1499',
  storageBucket: 'vocabtrainer-c1499.firebasestorage.app',
  messagingSenderId: '500696590945',
  appId: '1:500696590945:web:a178dc0e76774431e39820'
};

let ctx = null;
let pending = null;

export function connect() {
  if (ctx) return Promise.resolve(ctx);
  if (pending) return pending;
  pending = Promise.all([
    import('https://www.gstatic.com/firebasejs/' + V + '/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/' + V + '/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/' + V + '/firebase-firestore.js')
  ]).then(mods => {
    const [appMod, authMod, fsMod] = mods;
    const app = appMod.initializeApp(CFG);
    const auth = authMod.getAuth(app);
    return authMod.signInAnonymously(auth).then(cred => {
      ctx = { fs: fsMod, db: fsMod.getFirestore(app), uid: cred.user.uid };
      return ctx;
    });
  });
  return pending;
}

export function newCode() {
  const alpha = 'ACDEFGHJKLMNPQRSTUVWXY34679';
  let s = '';
  for (let i = 0; i < 4; i++) s += alpha[Math.floor(Math.random() * alpha.length)];
  return s;
}

function paths(c, code) {
  const { fs, db } = c;
  return {
    session: fs.doc(db, 'sessions', code),
    groups: fs.collection(db, 'sessions', code, 'groups'),
    players: fs.collection(db, 'sessions', code, 'players'),
    group: id => fs.doc(db, 'sessions', code, 'groups', id),
    player: id => fs.doc(db, 'sessions', code, 'players', id)
  };
}

// ---------- host ----------

export async function createSession(code, opts) {
  const c = await connect();
  const p = paths(c, code);
  await c.fs.setDoc(p.session, {
    hostUid: c.uid,
    state: 'running',
    goal: opts.goal,
    scope: opts.scope,
    defs: opts.defs,          // { wordId: definitionText } — no answers here
    createdAt: Date.now()
  });
  for (const g of opts.groups) {
    await c.fs.setDoc(p.group(g.id), {
      name: g.name, points: 0, memberCount: 0,
      currentWordId: g.currentWordId, status: 'ready', answeredAt: 0
    });
  }
  return c.uid;
}

export async function setGroup(code, groupId, patch) {
  const c = await connect();
  await c.fs.updateDoc(paths(c, code).group(groupId), patch);
}

export async function setPlayerVerdict(code, uid, lastAnswer) {
  const c = await connect();
  await c.fs.updateDoc(paths(c, code).player(uid), { lastAnswer: lastAnswer });
}

export async function finishSession(code, winner) {
  const c = await connect();
  await c.fs.updateDoc(paths(c, code).session, { state: 'finished', winner: winner });
}

export async function closeSession(code) {
  const c = await connect();
  const p = paths(c, code);
  const [gs, ps] = await Promise.all([c.fs.getDocs(p.groups), c.fs.getDocs(p.players)]);
  await Promise.all(gs.docs.map(d => c.fs.deleteDoc(d.ref)).concat(ps.docs.map(d => c.fs.deleteDoc(d.ref))));
  await c.fs.deleteDoc(p.session);
}

// ---------- player ----------

export async function readSession(code) {
  const c = await connect();
  const snap = await c.fs.getDoc(paths(c, code).session);
  return snap.exists() ? snap.data() : null;
}

export async function joinSession(code, groupId, firstName) {
  const c = await connect();
  const p = paths(c, code);
  await c.fs.setDoc(p.player(c.uid), { firstName: firstName, groupId: groupId, lastAnswer: null });
  await c.fs.updateDoc(p.group(groupId), { memberCount: c.fs.increment(1) });
  return c.uid;
}

export async function submitAnswer(code, wordId, text) {
  const c = await connect();
  await c.fs.updateDoc(paths(c, code).player(c.uid), {
    lastAnswer: { wordId: wordId, text: text, at: Date.now(), verdict: 'pending' }
  });
}

// ---------- watchers (all return an unsubscribe fn) ----------

export async function watchGroups(code, cb) {
  const c = await connect();
  return c.fs.onSnapshot(paths(c, code).groups, snap => {
    cb(snap.docs.map(d => Object.assign({ id: d.id }, d.data())));
  }, () => cb(null));
}

export async function watchPlayers(code, cb) {
  const c = await connect();
  return c.fs.onSnapshot(paths(c, code).players, snap => {
    cb(snap.docs.map(d => Object.assign({ uid: d.id }, d.data())));
  }, () => cb(null));
}

export async function watchGroup(code, groupId, cb) {
  const c = await connect();
  return c.fs.onSnapshot(paths(c, code).group(groupId), snap => {
    cb(snap.exists() ? Object.assign({ id: snap.id }, snap.data()) : null);
  }, () => cb(null));
}

export async function watchSession(code, cb) {
  const c = await connect();
  return c.fs.onSnapshot(paths(c, code).session, snap => {
    cb(snap.exists() ? snap.data() : null);
  }, () => cb(null));
}

export async function watchMe(code, cb) {
  const c = await connect();
  return c.fs.onSnapshot(paths(c, code).player(c.uid), snap => {
    cb(snap.exists() ? snap.data() : null);
  }, () => cb(null));
}

export async function myUid() { return (await connect()).uid; }
