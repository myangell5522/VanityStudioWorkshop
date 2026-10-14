// Vanity Studio Workshop relay.
//
// The game can read the Workshop straight from GitHub, but it can't write to it without a token,
// and a token must never ship inside a mod. This tiny Cloudflare Worker holds the token instead:
// the game POSTs a submission here, the worker checks it and turns it into a commit.
//
// By default every submission becomes a pull request you review and merge (AUTO_PUBLISH = "false").
// With AUTO_PUBLISH = "true", brand-new items go straight to main; updates to an existing item
// still go through a pull request, because nothing proves the sender is the original author.
//
// Environment (see wrangler.toml and README.md):
//   GITHUB_TOKEN   secret, fine-grained token with Contents + Pull requests: read & write on the repo
//   REPO           "myangell5522/VanityStudioWorkshop"
//   BRANCH         "main"
//   AUTO_PUBLISH   "false" | "true"
//   RATE           optional KV namespace binding, limits uploads per IP

const MAX_BODY = 3 * 1024 * 1024;
const MAX_DESIGN = 2 * 1024 * 1024;
const MAX_THUMB = 300 * 1024;
const MAX_AVATAR = 200 * 1024;
const PER_HOUR = 10;
const KINDS = new Set(["Wearable", "Item", "NPC", "Projectile"]);
const SLOTS = new Set(["", "Head", "Body", "Legs", "Front", "Back"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    if (request.method === "GET" && url.pathname === "/") {
      return json(200, { ok: true, message: "Vanity Studio Workshop relay is running." });
    }
    if (request.method !== "POST" || url.pathname !== "/publish") {
      return json(404, { ok: false, message: "Not found" });
    }
    try {
      return await publish(request, env);
    } catch (e) {
      return json(500, { ok: false, message: "Relay error: " + (e && e.message ? e.message : e) });
    }
  },
};

async function publish(request, env) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY) return json(413, { ok: false, message: "Upload too large" });

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (env.RATE) {
    const key = `ip:${ip}:${Math.floor(Date.now() / 3600000)}`;
    const used = Number((await env.RATE.get(key)) || 0);
    if (used >= PER_HOUR) return json(429, { ok: false, message: "Too many uploads, try again in an hour" });
    await env.RATE.put(key, String(used + 1), { expirationTtl: 3700 });
  }

  const text = await request.text();
  if (text.length > MAX_BODY) return json(413, { ok: false, message: "Upload too large" });
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { ok: false, message: "Not JSON" });
  }

  const m = body && body.meta;
  if (!m) return json(400, { ok: false, message: "Missing meta" });
  const id = String(m.id || "");
  const author = String(m.authorId || "");
  if (!/^[0-9a-f]{32}$/.test(id)) return json(400, { ok: false, message: "Bad item id" });
  if (!/^\d{1,20}$/.test(author) || author === "0") {
    return json(400, { ok: false, message: "Publishing needs Steam (no Steam id was sent)" });
  }
  const kind = String(m.kind || "");
  const slot = String(m.slot || "");
  if (!KINDS.has(kind) || !SLOTS.has(slot)) return json(400, { ok: false, message: "Bad kind or slot" });
  const name = clean(m.name, 40);
  if (!name) return json(400, { ok: false, message: "A name is needed" });

  const design = b64(body.design);
  const thumb = b64(body.thumb);
  const avatar = body.avatar ? b64(body.avatar) : null;
  if (!design || design.bytes.length > MAX_DESIGN || !startsWith(design.bytes, [86, 83, 68, 49])) {
    return json(400, { ok: false, message: "The design file is missing or broken" });
  }
  if (!thumb || thumb.bytes.length > MAX_THUMB || !isPng(thumb.bytes)) {
    return json(400, { ok: false, message: "The thumbnail is missing or broken" });
  }
  if (avatar && (avatar.bytes.length > MAX_AVATAR || !isPng(avatar.bytes))) {
    return json(400, { ok: false, message: "The avatar is broken" });
  }

  const authorName = clean(m.authorName, 40) || "Player";
  // only known fields make it into the repository, re-serialised by us
  const meta = {
    id,
    name,
    description: clean(m.description, 200),
    kind,
    slot,
    target: clean(m.target, 120),
    basedOn: clean(m.basedOn, 80),
    authorId: author,
    authorName,
    frames: int(m.frames, 1, 24),
    width: int(m.width, 1, 512),
    height: int(m.height, 1, 512),
    modVersion: clean(m.modVersion, 20),
    created: new Date().toISOString(),
  };

  const dir = `items/${author}/${id}`;
  const files = [
    { path: `${dir}/design.vsd`, base64: design.base64 },
    { path: `${dir}/thumb.png`, base64: thumb.base64 },
    { path: `${dir}/meta.json`, base64: utf8b64(JSON.stringify(meta, null, 1) + "\n") },
    { path: `authors/${author}/author.json`, base64: utf8b64(JSON.stringify({ name: authorName, updated: meta.created }, null, 1) + "\n") },
  ];
  if (avatar) files.push({ path: `authors/${author}/avatar.png`, base64: avatar.base64 });

  const gh = github(env);
  const branch = env.BRANCH || "main";
  const exists = await gh.exists(`${dir}/meta.json`, branch);
  if (exists) {
    // keep the original creation date on updates
    try {
      const old = await gh.json(`contents/${dir}/meta.json?ref=${branch}`);
      const prev = JSON.parse(atobUtf8(old.content));
      if (prev.created) meta.created = prev.created;
      files[2].base64 = utf8b64(JSON.stringify(meta, null, 1) + "\n");
    } catch { /* keep the new date */ }
  }

  const base = await gh.json(`git/ref/heads/${branch}`);
  const baseSha = base.object.sha;
  const baseCommit = await gh.json(`git/commits/${baseSha}`);
  const tree = [];
  for (const f of files) {
    const blob = await gh.post("git/blobs", { content: f.base64, encoding: "base64" });
    tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  const newTree = await gh.post("git/trees", { base_tree: baseCommit.tree.sha, tree });
  const verb = exists ? "Update" : "Add";
  const commit = await gh.post("git/commits", {
    message: `${verb} "${name}" by ${authorName}`,
    tree: newTree.sha,
    parents: [baseSha],
  });

  if (env.AUTO_PUBLISH === "true" && !exists) {
    await gh.patch(`git/refs/heads/${branch}`, { sha: commit.sha, force: false });
    return json(200, { ok: true, message: "Published. It shows up in the Workshop in a minute or two." });
  }

  const head = `submission/${author}-${id.slice(0, 8)}-${Date.now()}`;
  await gh.post("git/refs", { ref: `refs/heads/${head}`, sha: commit.sha });
  const what = meta.basedOn ? `Rework of ${meta.basedOn}` : `Original ${kind === "Wearable" ? slot : kind}`;
  const pr = await gh.post("pulls", {
    title: `${verb}: ${name} (${authorName})`,
    head,
    base: branch,
    body: [
      `**${name}** by **${authorName}** (Steam id ${author})`,
      "",
      `${what}${meta.target ? ` - \`${meta.target}\`` : ""}`,
      meta.description ? `> ${meta.description}` : "",
      "",
      `![thumbnail](https://raw.githubusercontent.com/${env.REPO}/${head}/${dir}/thumb.png)`,
      "",
      exists ? "This updates an existing item. Check it's from the same person before merging." : "",
      "Merging publishes it; index.json is rebuilt automatically.",
    ].join("\n"),
  });
  return json(200, { ok: true, message: "Sent for review, it appears once it's approved.", url: pr.html_url });
}

function github(env) {
  const root = `https://api.github.com/repos/${env.REPO}/`;
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "vanity-studio-relay",
  };
  async function call(method, path, data) {
    const res = await fetch(root + path, {
      method,
      headers: data ? { ...headers, "Content-Type": "application/json" } : headers,
      body: data ? JSON.stringify(data) : undefined,
    });
    if (!res.ok) throw new Error(`GitHub ${method} ${path.split("?")[0]} -> ${res.status}`);
    return res.json();
  }
  return {
    json: (path) => call("GET", path),
    post: (path, data) => call("POST", path, data),
    patch: (path, data) => call("PATCH", path, data),
    async exists(path, ref) {
      const res = await fetch(`${root}contents/${path}?ref=${ref}`, { headers });
      return res.status === 200;
    },
  };
}

function clean(v, max) {
  if (typeof v !== "string") return "";
  // no control characters, no markdown/HTML tricks in names that end up in PR titles
  return v.replace(/[\u0000-\u001f\u007f<>`]/g, "").trim().slice(0, max);
}

function int(v, min, max) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

function b64(s) {
  if (typeof s !== "string" || !s.length || !/^[A-Za-z0-9+/=]+$/.test(s)) return null;
  try {
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { base64: s, bytes };
  } catch {
    return null;
  }
}

function utf8b64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function atobUtf8(b) {
  const bin = atob(b.replace(/\n/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function startsWith(bytes, sig) {
  return sig.every((b, i) => bytes[i] === b);
}

function isPng(bytes) {
  return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function cors(res) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}

function json(status, data) {
  return cors(new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }));
}
