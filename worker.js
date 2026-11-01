//#region ../../node_modules/.pnpm/universal-github-app-jwt@2.2.2/node_modules/universal-github-app-jwt/lib/utils.js
/**
* @param {string} privateKey
* @returns {boolean}
*/
function isPkcs1(privateKey) {
	return privateKey.includes("-----BEGIN RSA PRIVATE KEY-----");
}
/**
* @param {string} privateKey
* @returns {boolean}
*/
function isOpenSsh(privateKey) {
	return privateKey.includes("-----BEGIN OPENSSH PRIVATE KEY-----");
}
/**
* @param {string} str
* @returns {ArrayBuffer}
*/
function string2ArrayBuffer(str) {
	const buf = new ArrayBuffer(str.length);
	const bufView = new Uint8Array(buf);
	for (let i = 0, strLen = str.length; i < strLen; i++) bufView[i] = str.charCodeAt(i);
	return buf;
}
/**
* @param {string} pem
* @returns {ArrayBuffer}
*/
function getDERfromPEM(pem) {
	const pemB64 = pem.trim().split("\n").slice(1, -1).join("");
	return string2ArrayBuffer(atob(pemB64));
}
/**
* @param {import('../internals').Header} header
* @param {import('../internals').Payload} payload
* @returns {string}
*/
function getEncodedMessage(header, payload) {
	return `${base64encodeJSON(header)}.${base64encodeJSON(payload)}`;
}
/**
* @param {ArrayBuffer} buffer
* @returns {string}
*/
function base64encode(buffer) {
	var binary = "";
	var bytes = new Uint8Array(buffer);
	var len = bytes.byteLength;
	for (var i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
	return fromBase64(btoa(binary));
}
/**
* @param {string} base64
* @returns {string}
*/
function fromBase64(base64) {
	return base64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
/**
* @param {Record<string,unknown>} obj
* @returns {string}
*/
function base64encodeJSON(obj) {
	return fromBase64(btoa(JSON.stringify(obj)));
}
//#endregion
//#region ../../node_modules/.pnpm/universal-github-app-jwt@2.2.2/node_modules/universal-github-app-jwt/lib/crypto-native.js
const { subtle } = globalThis.crypto;
function convertPrivateKey(privateKey) {
	return privateKey;
}
//#endregion
//#region ../../node_modules/.pnpm/universal-github-app-jwt@2.2.2/node_modules/universal-github-app-jwt/lib/get-token.js
/**
* @param {import('../internals').GetTokenOptions} options
* @returns {Promise<string>}
*/
async function getToken({ privateKey, payload }) {
	const convertedPrivateKey = convertPrivateKey(privateKey);
	/* c8 ignore start */
	if (isPkcs1(convertedPrivateKey)) throw new Error("[universal-github-app-jwt] Private Key is in PKCS#1 format, but only PKCS#8 is supported. See https://github.com/gr2m/universal-github-app-jwt#private-key-formats");
	/* c8 ignore stop */
	if (isOpenSsh(convertedPrivateKey)) throw new Error("[universal-github-app-jwt] Private Key is in OpenSSH format, but only PKCS#8 is supported. See https://github.com/gr2m/universal-github-app-jwt#private-key-formats");
	const algorithm = {
		name: "RSASSA-PKCS1-v1_5",
		hash: { name: "SHA-256" }
	};
	/** @type {import('../internals').Header} */
	const header = {
		alg: "RS256",
		typ: "JWT"
	};
	const privateKeyDER = getDERfromPEM(convertedPrivateKey);
	const importedKey = await subtle.importKey("pkcs8", privateKeyDER, algorithm, false, ["sign"]);
	const encodedMessage = getEncodedMessage(header, payload);
	const encodedMessageArrBuf = string2ArrayBuffer(encodedMessage);
	return `${encodedMessage}.${base64encode(await subtle.sign(algorithm.name, importedKey, encodedMessageArrBuf))}`;
}
//#endregion
//#region ../../node_modules/.pnpm/universal-github-app-jwt@2.2.2/node_modules/universal-github-app-jwt/index.js
/**
* @param {import(".").Options} options
* @returns {Promise<import(".").Result>}
*/
async function githubAppJwt({ id, privateKey, now = Math.floor(Date.now() / 1e3) }) {
	const privateKeyWithNewlines = privateKey.replace(/\\n/g, "\n");
	const nowWithSafetyMargin = now - 30;
	const expiration = nowWithSafetyMargin + 600;
	return {
		appId: id,
		expiration,
		token: await getToken({
			privateKey: privateKeyWithNewlines,
			payload: {
				iat: nowWithSafetyMargin,
				exp: expiration,
				iss: id
			}
		})
	};
}
//#endregion
//#region src/github.ts
/** GitHub answered with an error. `status` is GitHub's, or 0 if it couldn't be reached. */
var GitHubError = class extends Error {
	status;
	body;
	name = "GitHubError";
	constructor(status, message, body = {}) {
		super(message);
		this.status = status;
		this.body = body;
	}
};
async function github(config, path, init = {}) {
	const headers = {
		accept: init.accept ?? (init.web ? "application/json" : "application/vnd.github+json"),
		"user-agent": "goodfellow-sign-in"
	};
	if (!init.web) headers["x-github-api-version"] = "2022-11-28";
	if (init.auth && "bearer" in init.auth) headers.authorization = `Bearer ${init.auth.bearer}`;
	if (init.auth && "basic" in init.auth) headers.authorization = `Basic ${btoa(init.auth.basic.join(":"))}`;
	if (init.body !== void 0) headers["content-type"] = "application/json";
	let response;
	try {
		response = await config.fetch(`${init.web ? config.web : config.api}${path}`, {
			method: init.method ?? "GET",
			headers,
			body: init.body === void 0 ? void 0 : JSON.stringify(init.body)
		});
	} catch (error) {
		throw new GitHubError(0, `Couldn't reach GitHub: ${error.message}`);
	}
	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		throw new GitHubError(response.status, `GitHub answered ${response.status}: ${body.message ?? ""}`, body);
	}
	return response;
}
async function githubJson(config, path, init) {
	return await (await github(config, path, init)).json();
}
function repoPath(repo) {
	return repo.split("/").map(encodeURIComponent).join("/");
}
/** Exchanges OAuth's code for the person's own token. GitHub answers 200 even when it refuses. */
async function userTokens(config, app, grant, now) {
	const answer = await githubJson(config, "/login/oauth/access_token", {
		web: true,
		method: "POST",
		body: {
			client_id: app.clientId,
			client_secret: app.clientSecret,
			code: grant.code,
			redirect_uri: grant.redirectUri
		}
	});
	if (!answer.access_token) throw new GitHubError(401, `GitHub didn't accept the sign-in: ${answer.error_description ?? answer.error ?? ""}`);
	return {
		access: answer.access_token,
		accessExpires: answer.expires_in ? now + answer.expires_in * 1e3 : void 0
	};
}
/** Revokes a person's user access token, as signing out does. */
async function revokeUserToken(config, app, token) {
	await github(config, `/applications/${encodeURIComponent(app.clientId)}/token`, {
		method: "DELETE",
		auth: { basic: [app.clientId, app.clientSecret] },
		body: { access_token: token }
	});
}
/** A token for one repository, with only these permissions, lasting an hour. */
async function installationToken(config, jwt, installation, repo, permissions) {
	const answer = await githubJson(config, `/app/installations/${installation}/access_tokens`, {
		method: "POST",
		auth: { bearer: jwt },
		body: {
			repositories: [repo.split("/")[1] ?? ""],
			permissions
		}
	});
	return {
		token: answer.token,
		expiresAt: answer.expires_at
	};
}
//#endregion
//#region src/seal.ts
/**
* Sealed values: JSON encrypted with AES-GCM under a key only the worker has,
* so the browser can hold sign-in state it can neither read nor change. Each
* sealed value has a kind, which is checked when it's opened, so a value made
* for one purpose can't be used for another, and an expiry.
*/
function base64UrlEncode(bytes) {
	let binary = "";
	for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64UrlDecode(text) {
	const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
	return Uint8Array.from(atob(base64 + "=".repeat((4 - base64.length % 4) % 4)), (char) => char.charCodeAt(0));
}
const IV_BYTES = 12;
/** Seals values with `key`: 32 random bytes, base64-encoded, such as from `openssl rand -base64 32`. */
async function createSealer(key, now = Date.now) {
	let raw;
	try {
		raw = base64UrlDecode(key.trim());
	} catch {
		throw new Error("SESSION_KEY must be base64.");
	}
	if (raw.length !== 32) throw new Error("SESSION_KEY must be 32 bytes, such as from `openssl rand -base64 32`.");
	const cryptoKey = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
	const encoder = new TextEncoder();
	return {
		async seal(kind, value, lifetimeMs) {
			const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
			const plain = encoder.encode(JSON.stringify({
				expires: now() + lifetimeMs,
				value
			}));
			const sealed = new Uint8Array(await crypto.subtle.encrypt({
				name: "AES-GCM",
				iv,
				additionalData: encoder.encode(kind)
			}, cryptoKey, plain));
			const out = new Uint8Array(IV_BYTES + sealed.length);
			out.set(iv);
			out.set(sealed, IV_BYTES);
			return base64UrlEncode(out);
		},
		async open(kind, sealed) {
			if (typeof sealed !== "string" || sealed.length > 16384 || !/^[\w-]+$/.test(sealed)) return void 0;
			try {
				const bytes = base64UrlDecode(sealed);
				const plain = await crypto.subtle.decrypt({
					name: "AES-GCM",
					iv: bytes.subarray(0, IV_BYTES),
					additionalData: encoder.encode(kind)
				}, cryptoKey, bytes.subarray(IV_BYTES));
				const { expires, value } = JSON.parse(new TextDecoder().decode(plain));
				return typeof expires === "number" && expires > now() ? value : void 0;
			} catch {
				return;
			}
		}
	};
}
/** PKCE's S256: the challenge the admin panel sends is the hash of a verifier only it knows. */
async function challengeFor(verifier) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	return base64UrlEncode(new Uint8Array(digest));
}
//#endregion
//#region src/setup.ts
/** The secrets' prefixes in `wrangler.jsonc` and the worker's settings. */
const PREFIX = {
	edit: "EDIT",
	owner: "OWNER"
};
/** What each app may do: everything the worker asks for in its tokens, since a token can't have more than its app. */
function appPermissions(kind) {
	const purposes = kind === "edit" ? [PERMISSIONS.edit] : [PERMISSIONS.owner, PERMISSIONS.setup];
	const permissions = {};
	for (const purpose of purposes) for (const [name, level] of Object.entries(purpose)) if (permissions[name] !== "write") permissions[name] = level;
	return permissions;
}
const DESCRIPTIONS = {
	edit: "Signs editors in to Goodfellow sites' admin panels, which can then change the site's files.",
	owner: "Lets the owners of Goodfellow sites change who edits them and their GitHub Pages settings, and create new sites."
};
/** A GitHub App manifest, as GitHub's "Create a GitHub App from a manifest" takes it. */
function appManifest(options) {
	const worker = options.worker.replace(/\/$/, "");
	return {
		name: options.name,
		url: options.homepage ?? "https://goodfellow-cms.github.io/goodfellow-cms/",
		description: DESCRIPTIONS[options.kind],
		hook_attributes: {
			url: worker,
			active: false
		},
		redirect_url: options.redirect,
		callback_urls: [`${worker}/github/callback`],
		request_oauth_on_install: true,
		public: options.public,
		default_permissions: appPermissions(options.kind),
		default_events: []
	};
}
/** Where to post a manifest: the person's own settings, or an organization's. */
function manifestAction(state, organization, web = "https://github.com") {
	return `${organization ? `${web}/organizations/${encodeURIComponent(organization)}/settings/apps/new` : `${web}/settings/apps/new`}?${new URLSearchParams({ state })}`;
}
/** Turns the code GitHub came back with into the app's details. Each code works once, within an hour. */
async function convertManifest(code, fetcher = fetch, api = "https://api.github.com") {
	const response = await fetcher(`${api}/app-manifests/${encodeURIComponent(code)}/conversions`, {
		method: "POST",
		headers: {
			accept: "application/vnd.github+json",
			"x-github-api-version": "2022-11-28"
		}
	});
	if (!response.ok) throw new Error(`GitHub didn't give the app's details (${response.status}). Try creating the app again.`);
	const app = await response.json();
	if (!app.id || !app.slug || !app.client_id || !app.client_secret || !app.pem) throw new Error("GitHub's answer didn't include the app's keys. Try creating the app again.");
	return app;
}
/** The worker's secrets for an app. */
function appSecrets(kind, app) {
	const prefix = PREFIX[kind];
	return {
		[`${prefix}_APP_ID`]: String(app.id),
		[`${prefix}_CLIENT_ID`]: app.client_id,
		[`${prefix}_CLIENT_SECRET`]: app.client_secret,
		[`${prefix}_PRIVATE_KEY`]: app.pem
	};
}
/** The setting naming an app's slug, which the worker links to its install page with. */
function slugVar(kind) {
	return `${PREFIX[kind]}_APP_SLUG`;
}
/** A key for sealing sessions: 32 random bytes, in base64. */
function newSessionKey() {
	let binary = "";
	for (const byte of crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(32))) binary += String.fromCharCode(byte);
	return btoa(binary);
}
/**
* The page in Cloudflare's dashboard that makes the token, with its
* permissions filled in: editing Workers, which writes the worker's secrets,
* and reading the account's settings, which finds the account it's in.
*/
const TOKEN_TEMPLATE_URL = `https://dash.cloudflare.com/profile/api-tokens?${new URLSearchParams({
	permissionGroupKeys: JSON.stringify([{
		key: "workers_scripts",
		type: "edit"
	}, {
		key: "account_settings",
		type: "read"
	}]),
	accountId: "*",
	zoneId: "all",
	name: "Goodfellow sign-in setup"
})}`;
const SETUP_COOKIE = "__Host-goodfellow_setup";
const SETUP_KIND = "self-setup";
const SETUP_LIFETIME = 18e5;
/** How soon a page waiting for Cloudflare to start the worker's new version looks again, in seconds. */
const RELOAD_SECONDS = 4;
/** The most addresses `ALLOWED_ORIGINS` takes from the page. */
const MAX_ADDRESSES = 20;
var SetupProblem = class extends Error {};
/** Whether the worker has everything it needs to sign people in. */
function isConfigured(env) {
	return Boolean(env.SESSION_KEY && env.EDIT_APP_ID && env.EDIT_PRIVATE_KEY && env.OWNER_APP_ID && env.OWNER_PRIVATE_KEY);
}
/**
* The sites' addresses from what the owner typed: origins only, `https://`,
* one per line or separated by commas. Throws for anything else.
*/
function parseAddresses(text) {
	const found = [];
	for (const part of text.split(/[\s,]+/)) {
		if (!part) continue;
		let url;
		try {
			url = new URL(part.includes("://") ? part : `https://${part}`);
		} catch {
			throw new SetupProblem(`${part} isn't an address.`);
		}
		if (url.protocol !== "https:") throw new SetupProblem(`${part} needs to start with https://.`);
		if (!found.includes(url.origin)) found.push(url.origin);
	}
	if (found.length === 0) throw new SetupProblem("Give at least one address: the site's own, such as https://example.org.");
	if (found.length > MAX_ADDRESSES) throw new SetupProblem(`Give at most ${MAX_ADDRESSES} addresses.`);
	return found;
}
/** A GitHub App name, which GitHub takes up to 34 characters of, from the first site's address. */
function appName(kind, addresses) {
	const host = addresses[0] ? new URL(addresses[0]).hostname.replace(/^www\./, "") : "";
	return `${kind === "edit" ? "Goodfellow" : "Goodfellow owners"} ${host}`.trim().slice(0, 34).trim();
}
function createSelfSetup(options) {
	const githubOrigin = new URL(options.github.web).origin;
	const htmlPage = (title, body, headers = {}, status = 200) => page$1(title, body, headers, status, githubOrigin);
	const waitingPage = (headers = {}, seconds = RELOAD_SECONDS) => htmlPage("Set up the sign-in service", `<p role="status">Saved. Cloudflare is starting the service with its new settings, which takes a few seconds; this page goes on by itself.</p>
<p><a href="/setup">Go on now</a></p>`, {
		...headers,
		refresh: `${seconds}; url=/setup`
	});
	/** The apps made so far: those the worker's settings have, and those this setup saved, which they may not show yet. */
	const madeApps = (env, state) => ["edit", "owner"].filter((kind) => state.made.includes(kind) || Boolean(kind === "edit" ? env.EDIT_APP_ID : env.OWNER_APP_ID));
	const addressesOf = (env) => (env.ALLOWED_ORIGINS ?? "").split(",").filter(Boolean);
	const cloudflare = async (env, token, path, init = {}) => {
		const base = (env.CLOUDFLARE_API ?? "https://api.cloudflare.com/client/v4").replace(/\/$/, "");
		const response = await options.fetch(`${base}${path}`, {
			...init,
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
				...init.headers
			}
		});
		const body = await response.json().catch(() => void 0);
		return {
			ok: response.ok && body?.success !== false,
			status: response.status,
			result: body?.result
		};
	};
	/** The account the worker is in, as far as this token can see, or a problem to show. */
	async function findWorker(env, token) {
		const name = env.WORKER_NAME ?? "";
		const accounts = await cloudflare(env, token, "/accounts?per_page=50");
		if (accounts.status === 401 || accounts.status === 403 || !accounts.ok) throw new SetupProblem("Cloudflare didn't accept that token. Make a new one from the link, and paste all of it.");
		const list = Array.isArray(accounts.result) ? accounts.result : [];
		for (const account of list) {
			if (typeof account.id !== "string" || !/^[0-9a-f]{32}$/.test(account.id)) continue;
			if ((await cloudflare(env, token, `/accounts/${account.id}/workers/scripts/${encodeURIComponent(name)}/settings`)).ok) return account.id;
		}
		throw new SetupProblem(`That token can't reach this sign-in service (${name}). Make the token in the Cloudflare account the service was deployed to.`);
	}
	async function writeSecrets(env, state, secrets) {
		const name = encodeURIComponent(env.WORKER_NAME ?? "");
		for (const [key, value] of Object.entries(secrets)) if (!(await cloudflare(env, state.token, `/accounts/${state.account}/workers/scripts/${name}/secrets`, {
			method: "PUT",
			body: JSON.stringify({
				name: key,
				text: value,
				type: "secret_text"
			})
		})).ok) throw new SetupProblem("Cloudflare didn't save the service's settings. Check the token can edit Workers, then try again.");
	}
	async function sealState(key, state) {
		return (await createSealer(key, options.now)).seal(SETUP_KIND, state, SETUP_LIFETIME);
	}
	async function openState(request, env) {
		const sealed = cookie$1(request, SETUP_COOKIE);
		if (!sealed || !env.SESSION_KEY) return void 0;
		try {
			return await (await createSealer(env.SESSION_KEY, options.now)).open(SETUP_KIND, sealed);
		} catch {
			return;
		}
	}
	async function form(request) {
		if (!(request.headers.get("content-type") ?? "").startsWith("application/x-www-form-urlencoded")) throw new SetupProblem("Send the form from this page.");
		return new URLSearchParams(await request.text());
	}
	/** The page for the next app to make, or the end. */
	function appPage(url, state, made, addresses) {
		const next = ["edit", "owner"].find((kind) => !made.includes(kind));
		if (!next) return htmlPage("The sign-in service is set up", `<p>Both GitHub Apps are made, and the service has everything it needs.</p>
<p>Its address is <strong>${escapeHtml$1(url.origin)}</strong>. In your site's admin panel, open <strong>Site Settings → Security</strong>, put that address under <strong>Sign-in service</strong> and publish. The first time you sign in after the site has rebuilt, it offers to install the app on the site's repository.</p>
<p>You can now delete the Cloudflare token you made for this page, in Cloudflare's <strong>My Profile → API Tokens</strong>: the service doesn't keep it.</p>`, { "set-cookie": clearCookie() });
		const manifest = appManifest({
			kind: next,
			name: appName(next, addresses),
			worker: url.origin,
			redirect: `${url.origin}/setup/github/callback`,
			public: state.public
		});
		const action = manifestAction(`${next}.${state.nonce}`, state.organization, options.github.web);
		const what = next === "edit" ? "the editors' app, which signs editors in" : "the owners' app, which owners use to change who edits a site, its domain and its updates";
		return htmlPage("Set up the sign-in service", `${made.includes("edit") ? "<p>Made the editors' app.</p>" : "<p>Saved the sites' addresses.</p>"}
<p>Next, make ${what}. GitHub shows its settings, filled in already: check the name, which people see when they sign in (GitHub needs it to be unused), and choose <strong>Create GitHub App</strong>.</p>
<form method="post" action="${escapeHtml$1(action)}">
<input type="hidden" name="manifest" value="${escapeHtml$1(JSON.stringify(manifest))}">
<button type="submit">Make ${next === "edit" ? "the editors' app" : "the owners' app"} on GitHub</button>
</form>`);
	}
	function firstPage(problem, values = {}) {
		return htmlPage("Set up the sign-in service", `<p>This sign-in service lets your sites' editors sign in with GitHub. It needs a few settings, which this page saves in Cloudflare for you.</p>
<ol>
<li><a href="${escapeHtml$1(TOKEN_TEMPLATE_URL)}" target="_blank" rel="noopener noreferrer">Make a Cloudflare API token</a>, in the account you deployed the service to. The link fills in what it needs: choose <strong>Continue to summary</strong>, then <strong>Create Token</strong>, and copy it.</li>
<li>Paste it here, with your sites' addresses, and choose <strong>Save and continue</strong>. The token is used only while you set the service up, and never kept.</li>
</ol>
${problem ? `<p class="problem" role="alert">${escapeHtml$1(problem)}</p>` : ""}
<form method="post" action="/setup/token">
<label>Cloudflare API token<input name="token" type="password" autocomplete="off" required value="${escapeHtml$1(values.token ?? "")}"></label>
<label>Your sites' addresses<textarea name="addresses" rows="3" required placeholder="https://example.org">${escapeHtml$1(values.addresses ?? "")}</textarea>
<span class="hint">Each site's address, and its admin address or token broker's if it has one, one per line. Tokens only ever go to these.</span></label>
<label>GitHub organization that owns the apps (optional)<input name="organization" autocomplete="off" value="${escapeHtml$1(values.organization ?? "")}">
<span class="hint">Leave it empty to make them in your own GitHub account. Only an organization's owners can make apps in it.</span></label>
<label class="check"><input type="checkbox" name="public" value="1"${values.public ? " checked" : ""}> Sites in other GitHub accounts will use this service too</label>
<button type="submit">Save and continue</button>
</form>`);
	}
	function configuredPage(problem, done) {
		return htmlPage("This sign-in service is set up", `<p>It has its GitHub Apps and its settings.</p>
${done ? "<p role=\"status\"><strong>Saved the new addresses.</strong> They take effect within a minute.</p>" : ""}
<h2>Change your sites' addresses</h2>
<p>Paste a Cloudflare API token from the account the service is in (<a href="${escapeHtml$1(TOKEN_TEMPLATE_URL)}" target="_blank" rel="noopener noreferrer">make one</a>) and the full list of addresses. It replaces the list.</p>
${problem ? `<p class="problem" role="alert">${escapeHtml$1(problem)}</p>` : ""}
<form method="post" action="/setup/addresses">
<label>Cloudflare API token<input name="token" type="password" autocomplete="off" required></label>
<label>Your sites' addresses<textarea name="addresses" rows="3" required placeholder="https://example.org"></textarea></label>
<button type="submit">Save the addresses</button>
</form>
<p class="hint">To make new GitHub Apps, delete the service's secrets in Cloudflare (the worker's <strong>Settings → Variables and Secrets</strong>), then open this page again.</p>`);
	}
	async function handle(request, env) {
		const url = new URL(request.url);
		const path = url.pathname.replace(/\/$/, "");
		if (!env.WORKER_NAME) return void 0;
		if (path === "" && request.method === "GET" && !isConfigured(env)) return new Response(null, {
			status: 302,
			headers: {
				location: "/setup",
				"cache-control": "no-store"
			}
		});
		if (path !== "/setup" && !path.startsWith("/setup/")) return void 0;
		try {
			if (path === "/setup" && request.method === "GET") {
				if (isConfigured(env)) return configuredPage();
				const state = await openState(request, env);
				if (state) return appPage(url, state, madeApps(env, state), addressesOf(env));
				if (cookie$1(request, SETUP_COOKIE) && !env.SESSION_KEY) return waitingPage();
				return firstPage();
			}
			if (path === "/setup/token" && request.method === "POST") {
				if (isConfigured(env)) return configuredPage();
				const fields = await form(request);
				const values = Object.fromEntries(fields);
				const token = (fields.get("token") ?? "").trim();
				const organization = (fields.get("organization") ?? "").trim() || void 0;
				try {
					if (!token) throw new SetupProblem("Paste the Cloudflare API token.");
					if (organization && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(organization)) throw new SetupProblem(`${organization} isn't a GitHub organization's name.`);
					const addresses = parseAddresses(fields.get("addresses") ?? "");
					const account = await findWorker(env, token);
					const key = env.SESSION_KEY ?? newSessionKey();
					await writeSecrets(env, {
						token,
						account
					}, {
						...!env.SESSION_KEY && { SESSION_KEY: key },
						ALLOWED_ORIGINS: addresses.join(",")
					});
					const sealed = await sealState(key, {
						token,
						account,
						...organization && { organization },
						public: fields.get("public") === "1",
						nonce: base64UrlEncode(crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(16))),
						made: []
					});
					return waitingPage({ "set-cookie": setCookie(sealed) }, env.SESSION_KEY ? 0 : RELOAD_SECONDS);
				} catch (error) {
					if (error instanceof SetupProblem) return firstPage(error.message, {
						...values,
						token: ""
					});
					throw error;
				}
			}
			if (path === "/setup/github/callback" && request.method === "GET") {
				if (isConfigured(env)) return configuredPage();
				const state = await openState(request, env);
				if (!state) return firstPage("This setup took longer than half an hour, or started in another browser. Start again.");
				const [kind, nonce] = (url.searchParams.get("state") ?? "").split(".");
				const code = url.searchParams.get("code") ?? "";
				if (kind !== "edit" && kind !== "owner" || nonce !== state.nonce || !code) return htmlPage("Set up the sign-in service", "<p class=\"problem\" role=\"alert\">GitHub came back without the app. <a href=\"/setup\">Try again</a>.</p>", {}, 400);
				if (madeApps(env, state).includes(kind)) return appPage(url, state, madeApps(env, state), addressesOf(env));
				const app = await convertManifest(code, options.fetch, options.github.api).catch((error) => {
					throw new SetupProblem(error instanceof Error ? error.message : "GitHub didn't give the app's details.");
				});
				await writeSecrets(env, state, {
					...appSecrets(kind, app),
					[slugVar(kind)]: app.slug
				});
				const next = {
					...state,
					made: [...state.made, kind],
					nonce: base64UrlEncode(crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(16)))
				};
				const made = madeApps(env, next);
				const sealed = await sealState(env.SESSION_KEY ?? "", next);
				const response = appPage(url, next, made, addressesOf(env));
				if (made.length < 2) response.headers.append("set-cookie", setCookie(sealed));
				return response;
			}
			if (path === "/setup/addresses" && request.method === "POST") {
				if (!isConfigured(env)) return firstPage();
				const fields = await form(request);
				try {
					const token = (fields.get("token") ?? "").trim();
					if (!token) throw new SetupProblem("Paste the Cloudflare API token.");
					const addresses = parseAddresses(fields.get("addresses") ?? "");
					await writeSecrets(env, {
						token,
						account: await findWorker(env, token)
					}, { ALLOWED_ORIGINS: addresses.join(",") });
					return configuredPage(void 0, true);
				} catch (error) {
					if (error instanceof SetupProblem) return configuredPage(error.message);
					throw error;
				}
			}
			return htmlPage("Not found", "<p>There's nothing here.</p>", {}, 404);
		} catch (error) {
			if (error instanceof SetupProblem) return htmlPage("Set up the sign-in service", `<p class="problem" role="alert">${escapeHtml$1(error.message)}</p><p><a href="/setup">Back</a></p>`, {}, 400);
			return htmlPage("Set up the sign-in service", "<p class=\"problem\" role=\"alert\">Something went wrong while setting the service up. Try again in a minute.</p><p><a href=\"/setup\">Back</a></p>", {}, 500);
		}
	}
	return { handle };
}
function setCookie(sealed) {
	return `${SETUP_COOKIE}=${sealed}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${SETUP_LIFETIME / 1e3}`;
}
function clearCookie() {
	return `${SETUP_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
}
function cookie$1(request, name) {
	for (const part of (request.headers.get("cookie") ?? "").split(";")) {
		const [key, ...value] = part.trim().split("=");
		if (key === name) return value.join("=");
	}
}
function escapeHtml$1(text) {
	return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
/** The setup page's own headers: nothing may frame it, and it loads nothing but its own style. */
function page$1(title, body, headers, status, github) {
	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml$1(title)}</title>
<style>
body { font: 16px/1.5 system-ui, sans-serif; max-width: 38rem; margin: 3rem auto; padding: 0 1rem; color: #1f2328; background: #fff; }
label { display: block; margin: 1rem 0; font-weight: 600; }
label.check { font-weight: 400; }
input:not([type=checkbox]), textarea { display: block; width: 100%; box-sizing: border-box; margin-top: 0.25rem; font: inherit; padding: 0.4rem; }
.hint { display: block; font-weight: 400; font-size: 0.9rem; color: #59636e; }
button { font: inherit; padding: 0.5rem 1rem; border-radius: 6px; border: 1px solid #1f883d; background: #1f883d; color: #fff; cursor: pointer; }
.problem { color: #b42318; }
a { color: #0969da; }
@media (prefers-color-scheme: dark) { body { color: #e6edf3; background: #0d1117; } .hint { color: #9198a1; } .problem { color: #ff7b72; } a { color: #4493f8; } input, textarea { background: #161b22; color: inherit; border: 1px solid #3d444d; } }
</style>
</head>
<body>
<h1>${escapeHtml$1(title)}</h1>
${body}
</body>
</html>
`;
	return new Response(html, {
		status,
		headers: {
			"content-type": "text/html; charset=utf-8",
			"cache-control": "no-store",
			"content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${github}; frame-ancestors 'none'; base-uri 'none'`,
			"x-frame-options": "DENY",
			"referrer-policy": "no-referrer",
			...headers
		}
	});
}
//#endregion
//#region src/worker.ts
/**
* Goodfellow's sign-in worker: editors sign in with GitHub, and the admin
* panel gets a token for one repository, with only the permissions it needs,
* lasting an hour. It stores nothing: the person's own GitHub token is revoked
* as soon as they've signed in, and the session the browser keeps says only
* who they are and which site it's for, sealed so it can't be changed.
*
* The admin panel asks:
* 1. `GET /github/check`: can this page sign in here at all?
* 2. `GET /github/start`: sends the person to GitHub, which comes back to
*    `/github/callback`, which goes back to the admin panel with a grant. With
*    `install=1`, GitHub's page installs Goodfellow first, and signs them in too.
* 3. `POST /github/session`: the grant and the PKCE verifier only that tab
*    knows, for a session and the first token.
* 4. `POST /github/token`: the session, for a new token, about once an hour,
*    checking the person still edits the site each time.
*
* Where a site keeps its content in a repository of its own, both ask with
* `code`, its code repository, and get a second token for it too, which can
* only read it and its workflow runs, or for an owner, run them: once the
* code's `goodfellow.config.tsx` names the site's repository, and GitHub says
* the person can see the code repository (or for an owner, publish to it).
*
* The site setup page signs in the same way, with `/github/setup/*` creating
* the repository. Creating it needs the person's own token, so the setup
* page's session keeps it, sealed, until the repository exists (both, for a
* site whose content has a repository of its own) or half an hour has passed,
* whichever is first; then it's revoked.
*/
/**
* What each kind of sign-in's tokens may do. Editors' tokens can't change
* workflows or the repository's settings. Checks and Commit statuses show
* when Cloudflare Pages has built the site.
*/
const PERMISSIONS = {
	edit: {
		contents: "write",
		pull_requests: "write",
		metadata: "read",
		deployments: "read",
		actions: "read",
		pages: "read",
		checks: "read",
		statuses: "read"
	},
	owner: {
		administration: "write",
		pages: "write",
		actions: "write",
		variables: "write",
		contents: "read",
		metadata: "read"
	},
	setup: {
		administration: "write",
		contents: "write",
		workflows: "write",
		pages: "write",
		secrets: "write",
		metadata: "read"
	}
};
/**
* Permissions added since the apps were first set up, which installations
* accept only when someone approves them on GitHub. Until then, tokens are
* made without them, and the admin panel does without what they're for.
*/
const LATER_PERMISSIONS = {
	edit: [
		"checks",
		"statuses",
		"pull_requests"
	],
	owner: ["variables"],
	setup: ["secrets"]
};
/** `permissions` without those an installation may not have accepted yet. */
function withoutLater(purpose, permissions) {
	const later = new Set(LATER_PERMISSIONS[purpose] ?? []);
	return Object.fromEntries(Object.entries(permissions).filter(([name]) => !later.has(name)));
}
/**
* What tokens for a site's code repository may do, where its content is kept
* in a repository of its own: read its updates' runs and its files, and for
* owners, run its update workflow. Never change its code.
*/
const CODE_PERMISSIONS = {
	edit: {
		actions: "read",
		contents: "read",
		metadata: "read"
	},
	owner: {
		actions: "write",
		contents: "read",
		metadata: "read"
	}
};
/** The file a site's code repository names its content repository in. */
const CONFIG_FILE = "goodfellow.config.tsx";
const STATE_LIFETIME = 6e5;
const GRANT_LIFETIME = 3e5;
const SESSION_LIFETIME = 432e5;
const REMEMBERED_SESSION_LIFETIME = 2592e6;
/** The setup page's session, which holds the person's own token, lasts only as long as creating a site takes. */
const SETUP_SESSION_LIFETIME = 18e5;
var Problem = class extends Error {
	problem;
	status;
	extra;
	constructor(problem, status, extra = {}) {
		super(problem);
		this.problem = problem;
		this.status = status;
		this.extra = extra;
	}
};
const REPO = /^[\w.-]+\/[\w.-]+$/;
const CHALLENGE = /^[\w-]{43}$/;
/** Addresses on the computer itself: tokens are never given to them, since `goodfellow dev` and `next dev` don't need one. */
function isLocalAddress(origin) {
	let host;
	try {
		host = new URL(origin).hostname.toLowerCase();
	} catch {
		return true;
	}
	return host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host === "[::1]" || /^127(\.\d{1,3}){3}$/.test(host);
}
function originOf(url) {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "https:" ? parsed.origin : void 0;
	} catch {
		return;
	}
}
/** The person as the admin panel sees them: GitHub's id isn't needed there. */
function publicUser({ login, name, avatarUrl, email }) {
	return {
		login,
		name,
		avatarUrl,
		email
	};
}
const PAGE_MESSAGES = {
	"not-installed": "Goodfellow isn't installed on the site's repository, perhaps because another was chosen. Go back to the admin panel and install it again, choosing the site.",
	"no-address": "The site's settings don't have its address yet, so signing in with GitHub can't check where to come back to.",
	"wrong-address": "This isn't the address the site's settings list, so signing in with GitHub can't come back here.",
	"local-address": "Signing in with GitHub works only on the published site. Sign in with an access token here instead.",
	invalid: "Signing in took too long. Go back and try again.",
	"bad-request": "This sign-in link isn't complete. Go back and try again.",
	unavailable: "Signing in with GitHub isn't working right now. Go back and sign in with an access token instead."
};
function page(problem, status = 400) {
	const message = PAGE_MESSAGES[problem] ?? PAGE_MESSAGES.unavailable;
	return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Couldn't sign in</title><main style="font: 16px/1.5 system-ui, sans-serif; max-width: 36rem; margin: 4rem auto; padding: 0 1rem"><h1>Couldn't sign in</h1><p>${message}</p></main></html>`, {
		status,
		headers: PAGE_HEADERS
	});
}
/** Headers for the worker's own pages, which nothing may show in a frame. */
const PAGE_HEADERS = {
	"content-type": "text/html; charset=utf-8",
	"cache-control": "no-store",
	"content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
	"x-frame-options": "DENY"
};
/** The cookie that shows an owner's sign-in was continued from the worker's own page, in the same browser. */
const CONFIRM_COOKIE = "__Host-goodfellow_confirm";
function escapeHtml(text) {
	return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
/**
* The page an owner's sign-in shows before going to GitHub, which may sign
* them in without asking: an editor can change the addresses the site's files
* name, so the owner sees where the token would go, and continues only from
* here, with a cookie a link from elsewhere can't set.
*/
function confirmPage(url, repo, origin, nonce) {
	const next = new URL(url);
	next.searchParams.set("confirm", nonce);
	const body = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in as an owner?</title><main style="font: 16px/1.5 system-ui, sans-serif; max-width: 36rem; margin: 4rem auto; padding: 0 1rem"><h1>Sign in as an owner?</h1><p>You're signing in with GitHub as an owner of <strong>${escapeHtml(repo)}</strong>, so the admin panel at <strong>${escapeHtml(origin)}</strong> can manage the site's editors, domain and updates.</p><p>Only continue if you opened the admin panel at that address yourself. If a link brought you here, close this page.</p><p><a href="${escapeHtml(next.href)}" style="display: inline-block; padding: 0.5rem 1rem; border-radius: 0.375rem; background: #1f2937; color: #fff; text-decoration: none">Continue to GitHub</a></p></main></html>`;
	return new Response(body, {
		status: 200,
		headers: {
			...PAGE_HEADERS,
			"set-cookie": `${CONFIRM_COOKIE}=${nonce}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=600`
		}
	});
}
function cookie(request, name) {
	for (const part of (request.headers.get("cookie") ?? "").split(";")) {
		const [key, ...value] = part.trim().split("=");
		if (key === name) return value.join("=");
	}
}
/** How long a check before signing in trusts the site's addresses it last read. */
const ADDRESS_CHECK_MS = 12e4;
function createWorker(options = {}) {
	const now = options.now ?? Date.now;
	const sealers = /* @__PURE__ */ new Map();
	const installations = /* @__PURE__ */ new Map();
	const checkedAddresses = /* @__PURE__ */ new Map();
	async function handle(request, env) {
		const url = new URL(request.url);
		const requestOrigin = request.headers.get("origin") ?? void 0;
		const cors = {
			"access-control-allow-origin": requestOrigin ?? "*",
			"access-control-allow-methods": "GET, POST",
			"access-control-allow-headers": "content-type",
			vary: "origin"
		};
		const json = (body, status = 200) => new Response(JSON.stringify(body), {
			status,
			headers: {
				"content-type": "application/json",
				"cache-control": "no-store",
				...cors
			}
		});
		if (request.method === "OPTIONS") return new Response(null, {
			status: 204,
			headers: cors
		});
		const config = {
			api: (env.GITHUB_API ?? "https://api.github.com").replace(/\/$/, ""),
			web: (env.GITHUB_WEB ?? "https://github.com").replace(/\/$/, ""),
			fetch: options.fetch ?? ((input, init) => fetch(input, init))
		};
		const origins = (list) => (list ?? "").split(",").map((origin) => origin.trim().replace(/\/$/, "")).filter(Boolean);
		const setupOrigins = origins(env.SETUP_ORIGINS);
		const allowedOrigins = origins(env.ALLOWED_ORIGINS);
		const apps = {};
		if (env.EDIT_APP_ID && env.EDIT_CLIENT_ID && env.EDIT_CLIENT_SECRET && env.EDIT_PRIVATE_KEY) apps.edit = {
			id: env.EDIT_APP_ID,
			slug: env.EDIT_APP_SLUG ?? "",
			clientId: env.EDIT_CLIENT_ID,
			clientSecret: env.EDIT_CLIENT_SECRET,
			privateKey: env.EDIT_PRIVATE_KEY
		};
		if (env.OWNER_APP_ID && env.OWNER_CLIENT_ID && env.OWNER_CLIENT_SECRET && env.OWNER_PRIVATE_KEY) apps.owner = {
			id: env.OWNER_APP_ID,
			slug: env.OWNER_APP_SLUG ?? "",
			clientId: env.OWNER_CLIENT_ID,
			clientSecret: env.OWNER_CLIENT_SECRET,
			privateKey: env.OWNER_PRIVATE_KEY
		};
		function appFor(purpose) {
			const app = purpose === "edit" ? apps.edit : apps.owner;
			if (!app) throw new Problem("unavailable", 503);
			return app;
		}
		function installUrl(app) {
			return `${config.web}/apps/${encodeURIComponent(app.slug)}/installations/new`;
		}
		/** A token for calling GitHub as the app itself, such as to make installation tokens. */
		async function jwtFor(app) {
			return (await githubAppJwt({
				id: app.id,
				privateKey: app.privateKey,
				now: Math.floor(now() / 1e3)
			})).token;
		}
		function sealer() {
			const key = env.SESSION_KEY ?? "";
			let found = sealers.get(key);
			if (!found) {
				found = createSealer(key, now);
				found.catch(() => sealers.delete(key));
				sealers.set(key, found);
			}
			return found.catch(() => {
				throw new Problem("unavailable", 503);
			});
		}
		/** The app's installation on a repository, or `undefined` if it isn't installed there. Remembered for five minutes. */
		async function installationFor(app, repo) {
			const key = `${app.id}:${repo.toLowerCase()}`;
			const cached = installations.get(key);
			if (cached && cached.id !== void 0 && now() - cached.at < 3e5) return cached.id;
			try {
				const { id } = await githubJson(config, `/repos/${repoPath(repo)}/installation`, { auth: { bearer: await jwtFor(app) } });
				installations.set(key, {
					id,
					at: now()
				});
				return id;
			} catch (error) {
				if (error instanceof GitHubError && error.status === 404) return void 0;
				throw error;
			}
		}
		/**
		* `make` called with the app's installation on the repository. Where GitHub
		* refuses the remembered installation, as it does once the app is
		* uninstalled or the repository taken out of it, it's looked up again, so
		* the person is told to install the app rather than that signing in isn't
		* working.
		*/
		async function withInstallation(app, repo, make) {
			const installation = await installationFor(app, repo);
			if (installation === void 0) throw new Problem("not-installed", 409, { installUrl: installUrl(app) });
			try {
				return await make(installation);
			} catch (error) {
				if (!(error instanceof GitHubError && (error.status === 404 || error.status === 422))) throw error;
				installations.delete(`${app.id}:${repo.toLowerCase()}`);
				const current = await installationFor(app, repo);
				if (current === void 0) throw new Problem("not-installed", 409, { installUrl: installUrl(app) });
				if (current === installation) throw error;
				return make(current);
			}
		}
		/**
		* The addresses tokens may go to: the Site address in the site's settings
		* (`content/site.json`), read with an installation token, and the admin
		* address and the site's other copies, such as staging, that the site's
		* build names there, if it has them. Empty without a Site address.
		*/
		async function siteAddresses(repo, token) {
			let url;
			try {
				const response = await github(config, `/repos/${repoPath(repo)}/contents/content/site.json`, {
					auth: { bearer: token },
					accept: "application/vnd.github.raw+json"
				});
				const settings = JSON.parse(await response.text());
				url = typeof settings.url === "string" ? settings.url : void 0;
			} catch (error) {
				if (error instanceof GitHubError && error.status !== 404) throw error;
			}
			const site = url && originOf(url);
			if (!url || !site) return [];
			const { admin, broker, copies = [] } = await describedAddresses(url);
			const addresses = broker ? [broker] : [.../* @__PURE__ */ new Set([
				site,
				...admin ? [admin] : [],
				...copies
			])];
			return allowedOrigins.length > 0 ? addresses.filter((address) => allowedOrigins.includes(address)) : addresses;
		}
		/**
		* The admin address, token broker and other copies of the site in its
		* description (`goodfellow-site.json`, which builds write from the site's
		* config) at the Site address, where editors sign in when the site has
		* them. Tokens already go to the Site address, so what it serves names no
		* address editors couldn't.
		*/
		async function describedAddresses(siteUrl) {
			try {
				const response = await config.fetch(new URL("goodfellow-site.json", siteUrl.replace(/\/?$/, "/")).href, { redirect: "error" });
				if (!response.ok) return {};
				const description = JSON.parse(await response.text());
				const address = (url) => {
					const origin = typeof url === "string" ? originOf(url) : void 0;
					return origin && !isLocalAddress(origin) ? origin : void 0;
				};
				const admin = address(description.admin?.url);
				const broker = address(description.broker?.url);
				const copies = (Array.isArray(description.copies) ? description.copies : []).map(address).filter((origin) => origin !== void 0);
				return {
					...admin && { admin },
					...broker && { broker },
					...copies.length > 0 && { copies }
				};
			} catch {
				return {};
			}
		}
		/** Checks that the app is installed on the repository and that `origin` is the site's own address, its admin address, another copy's, or its token broker's. */
		async function checkSite(purpose, repo, origin) {
			if (!origin || !originOf(origin) || isLocalAddress(origin)) throw new Problem("local-address", 403);
			const app = appFor(purpose);
			const verdict = (addresses, installation) => {
				if (addresses.length === 0) throw new Problem("no-address", 409);
				if (!addresses.includes(origin)) throw new Problem("wrong-address", 403);
				return installation;
			};
			const key = repo.toLowerCase();
			const checked = checkedAddresses.get(key);
			if (checked && now() - checked.at < ADDRESS_CHECK_MS) {
				const installation = await installationFor(app, repo);
				if (installation === void 0) throw new Problem("not-installed", 409, { installUrl: installUrl(app) });
				return verdict(checked.addresses, installation);
			}
			const jwt = await jwtFor(app);
			const { installation, reader } = await withInstallation(app, repo, async (installation) => ({
				installation,
				reader: await installationToken(config, jwt, installation, repo, {
					contents: "read",
					metadata: "read"
				})
			}));
			let addresses;
			try {
				addresses = await siteAddresses(repo, reader.token);
			} finally {
				await revoke(reader.token);
			}
			checkedAddresses.set(key, {
				addresses,
				at: now()
			});
			return verdict(addresses, installation);
		}
		async function revoke(token) {
			await github(config, "/installation/token", {
				method: "DELETE",
				auth: { bearer: token }
			}).catch(() => {});
		}
		function checkSetupOrigin(origin) {
			if (!origin || !setupOrigins.includes(origin)) throw new Problem("wrong-address", 403);
		}
		async function readBody() {
			try {
				const body = JSON.parse(await request.text());
				if (body && typeof body === "object") return body;
			} catch {}
			throw new Problem("bad-request", 400);
		}
		async function openSession(body, purpose) {
			const session = await (await sealer()).open("session", body.session);
			if (!session) throw new Problem("invalid", 401);
			if (session.origin !== requestOrigin) throw new Problem("wrong-address", 403);
			if (purpose && session.purpose !== purpose) throw new Problem("bad-request", 400);
			return session;
		}
		/** A session sealed again, lasting until its lifetime since the person signed in, never longer. */
		async function sealSession(session) {
			const lifetime = session.purpose === "setup" ? SETUP_SESSION_LIFETIME : session.remember ? REMEMBERED_SESSION_LIFETIME : SESSION_LIFETIME;
			const signedInAt = session.signedInAt ?? now();
			const left = signedInAt + lifetime - now();
			if (left <= 0) throw new Problem("invalid", 401);
			return (await sealer()).seal("session", {
				...session,
				signedInAt
			}, left);
		}
		/** What the person may do on the repository, as GitHub says. */
		function allowed(purpose, permissions) {
			if (purpose === "edit" && !permissions?.push) throw new Problem("cant-publish", 403);
			if (purpose === "owner" && !permissions?.admin) throw new Problem("not-owner", 403);
		}
		/** Whether the person may do what the sign-in is for, asked with their own token as they sign in. */
		async function checkAccess(purpose, repo, token) {
			let found;
			try {
				found = await githubJson(config, `/repos/${repoPath(repo)}`, { auth: { bearer: token } });
			} catch (error) {
				if (error instanceof GitHubError && error.status === 401) throw new Problem("invalid", 401);
				if (error instanceof GitHubError && (error.status === 403 || error.status === 404)) throw new Problem("no-access", 403);
				throw error;
			}
			allowed(purpose, found.permissions);
		}
		/** Whether the person still may, asked with an installation token, since the worker keeps no token of theirs. */
		async function checkStillAllowed(session, repo, token) {
			let found;
			try {
				found = await githubJson(config, `/repos/${repoPath(repo)}/collaborators/${encodeURIComponent(session.user.login)}/permission`, { auth: { bearer: token } });
			} catch (error) {
				if (error instanceof GitHubError && (error.status === 403 || error.status === 404)) throw new Problem("no-access", 403);
				throw error;
			}
			const permission = found.permission ?? "none";
			allowed(session.purpose, {
				push: found.user?.permissions?.push ?? [
					"admin",
					"maintain",
					"write"
				].includes(permission),
				admin: found.user?.permissions?.admin ?? permission === "admin"
			});
		}
		/**
		* A token for the session's repository, for the address it was issued to,
		* once GitHub says the person still edits the site (or owns it, for an
		* owner's sign-in), and the session to use next time.
		*/
		/** A token with a purpose's permissions, or, for an installation that hasn't accepted the later ones, without them. */
		async function purposeToken(jwt, installation, repo, purpose) {
			try {
				return await installationToken(config, jwt, installation, repo, PERMISSIONS[purpose]);
			} catch (error) {
				if (!(error instanceof GitHubError && error.status === 422) || !LATER_PERMISSIONS[purpose]) throw error;
				return installationToken(config, jwt, installation, repo, withoutLater(purpose, PERMISSIONS[purpose]));
			}
		}
		async function issue(session, code) {
			const repo = session.repo;
			if (!repo) throw new Problem("bad-request", 400);
			const app = appFor(session.purpose);
			const jwt = await jwtFor(app);
			const issued = await withInstallation(app, repo, (installation) => purposeToken(jwt, installation, repo, session.purpose));
			try {
				await checkStillAllowed(session, repo, issued.token);
				if (!(await siteAddresses(repo, issued.token)).includes(session.origin)) throw new Problem("wrong-address", 403);
				const sealed = await sealSession(session);
				const codeToken = await issueCode(session, code);
				return {
					session: sealed,
					token: issued.token,
					expiresAt: issued.expiresAt,
					user: publicUser(session.user),
					...codeToken && { code: codeToken }
				};
			} catch (error) {
				await revoke(issued.token);
				throw error;
			}
		}
		/** Whether the person may use the code repository as the token would, asked with that token. */
		async function mayUseCode(session, code, token) {
			const auth = { bearer: token };
			const permission = (await githubJson(config, `/repos/${repoPath(code)}/collaborators/${encodeURIComponent(session.user.login)}/permission`, { auth })).permission ?? "none";
			if (session.purpose === "owner") return [
				"admin",
				"maintain",
				"write"
			].includes(permission);
			if (permission !== "none") return true;
			return (await githubJson(config, `/repos/${repoPath(code)}`, { auth })).private === false;
		}
		/** Whether the code repository is the site's: its config names the site's repository, as its backend. */
		async function namesSite(code, site, token) {
			return (await (await github(config, `/repos/${repoPath(code)}/contents/${CONFIG_FILE}`, {
				auth: { bearer: token },
				accept: "application/vnd.github.raw+json"
			})).text()).toLowerCase().includes(JSON.stringify(site.toLowerCase()));
		}
		/**
		* A token for the site's code repository, or `undefined` where the worker
		* can't give one: Goodfellow isn't installed there, it isn't this site's
		* code, or the person can't see it. Signing in works either way.
		*/
		async function issueCode(session, code) {
			const repo = session.repo;
			if (typeof code !== "string" || !REPO.test(code) || !repo || code.toLowerCase() === repo.toLowerCase()) return;
			if (session.purpose === "setup") return void 0;
			const app = appFor(session.purpose);
			const installation = await installationFor(app, code);
			if (installation === void 0) return void 0;
			let issued;
			let given = false;
			try {
				issued = await installationToken(config, await jwtFor(app), installation, code, CODE_PERMISSIONS[session.purpose]);
				if (await namesSite(code, repo, issued.token) && await mayUseCode(session, code, issued.token)) {
					given = true;
					return issued;
				}
			} catch (error) {
				if (!(error instanceof GitHubError)) throw error;
			} finally {
				if (issued && !given) await revoke(issued.token);
			}
		}
		/** Who a person's own GitHub token belongs to, as sessions keep them. */
		async function signedInUser(token) {
			const found = await githubJson(config, "/user", { auth: { bearer: token } });
			return {
				id: found.id,
				login: found.login,
				name: found.name ?? void 0,
				avatarUrl: found.avatar_url,
				email: `${found.id}+${found.login}@users.noreply.github.com`
			};
		}
		function backTo(state, params) {
			const target = new URL(state.return);
			for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
			return new Response(null, {
				status: 302,
				headers: {
					location: target.toString(),
					"cache-control": "no-store"
				}
			});
		}
		async function userInstallations(token) {
			const found = [];
			for (let page = 1; page <= 10; page++) {
				const { installations = [] } = await githubJson(config, `/user/installations?per_page=100&page=${page}`, { auth: { bearer: token } });
				found.push(...installations);
				if (installations.length < 100) break;
			}
			return found;
		}
		try {
			const path = url.pathname.replace(/\/$/, "");
			const setupPage = await createSelfSetup({
				fetch: config.fetch,
				github: {
					api: config.api,
					web: config.web
				},
				now
			}).handle(request, env);
			if (setupPage) return setupPage;
			if (path === "" || path === "/health") return json({
				ok: Boolean(apps.edit && env.SESSION_KEY),
				apps: Object.fromEntries(Object.entries(apps).map(([kind, app]) => [kind, { slug: app.slug }]))
			});
			if (path === "/github/check" && request.method === "GET") {
				const purpose = url.searchParams.get("purpose") === "owner" ? "owner" : "edit";
				const repo = url.searchParams.get("repo") ?? "";
				if (!REPO.test(repo)) throw new Problem("bad-request", 400);
				await checkSite(purpose, repo, requestOrigin);
				return json({ ok: true });
			}
			if (path === "/github/start" && request.method === "GET") {
				const params = url.searchParams;
				const purposeParam = params.get("purpose");
				const purpose = purposeParam === "owner" || purposeParam === "setup" ? purposeParam : "edit";
				const back = params.get("return") ?? "";
				const origin = originOf(back);
				const challenge = params.get("challenge") ?? "";
				const repo = params.get("repo") ?? void 0;
				if (!origin || !CHALLENGE.test(challenge) || purpose !== "setup" && !REPO.test(repo ?? "")) return page("bad-request");
				const install = params.get("install") === "1";
				try {
					if (purpose === "setup") checkSetupOrigin(origin);
					else if (!install) await checkSite(purpose, repo ?? "", origin);
					else if (isLocalAddress(origin)) throw new Problem("local-address", 403);
				} catch (error) {
					if (error instanceof Problem) return page(error.problem, error.status);
					throw error;
				}
				if (purpose === "owner" && !allowedOrigins.includes(origin)) {
					const nonce = cookie(request, CONFIRM_COOKIE);
					if (!nonce || params.get("confirm") !== nonce) {
						const fresh = base64UrlEncode(crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(16)));
						return confirmPage(url, repo ?? "", origin, fresh);
					}
				}
				const state = {
					purpose,
					...purpose !== "setup" && { repo },
					return: back,
					challenge,
					remember: params.get("remember") === "1",
					...install && { install }
				};
				const sealed = await (await sealer()).seal("state", state, STATE_LIFETIME);
				const app = appFor(purpose);
				const location = install ? `${installUrl(app)}?${new URLSearchParams({ state: sealed })}` : `${config.web}/login/oauth/authorize?${new URLSearchParams({
					client_id: app.clientId,
					redirect_uri: `${url.origin}/github/callback`,
					state: sealed
				})}`;
				return new Response(null, {
					status: 302,
					headers: {
						location,
						"cache-control": "no-store"
					}
				});
			}
			if (path === "/github/callback" && request.method === "GET") {
				const state = await (await sealer()).open("state", url.searchParams.get("state"));
				if (!state) return page("invalid");
				const code = url.searchParams.get("code");
				const app = appFor(state.purpose);
				if (!code && url.searchParams.get("installation_id")) {
					const query = new URLSearchParams({
						client_id: app.clientId,
						redirect_uri: `${url.origin}/github/callback`,
						state: url.searchParams.get("state") ?? ""
					});
					return new Response(null, {
						status: 302,
						headers: {
							location: `${config.web}/login/oauth/authorize?${query}`,
							"cache-control": "no-store"
						}
					});
				}
				const origin = new URL(state.return).origin;
				if (state.install && state.repo) try {
					await checkSite(state.purpose, state.repo, origin);
				} catch (error) {
					if (error instanceof Problem) return page(error.problem, error.status);
					throw error;
				}
				if (!code) return backTo(state, { goodfellow_sign_in_error: "cancelled" });
				if (state.purpose === "setup") {
					const grant = {
						purpose: "setup",
						origin,
						remember: state.remember,
						signedInAt: now(),
						challenge: state.challenge,
						code
					};
					return backTo(state, { goodfellow_sign_in: await (await sealer()).seal("grant", grant, GRANT_LIFETIME) });
				}
				let tokens;
				try {
					tokens = await userTokens(config, app, {
						code,
						redirectUri: `${url.origin}/github/callback`
					}, now());
					const user = await signedInUser(tokens.access);
					if (state.repo) await checkAccess(state.purpose, state.repo, tokens.access);
					const grant = {
						purpose: state.purpose,
						repo: state.repo,
						origin,
						remember: state.remember,
						signedInAt: now(),
						challenge: state.challenge,
						user
					};
					await revokeUserToken(config, app, tokens.access);
					return backTo(state, { goodfellow_sign_in: await (await sealer()).seal("grant", grant, GRANT_LIFETIME) });
				} catch (error) {
					if (tokens) await revokeUserToken(config, app, tokens.access).catch(() => {});
					if (error instanceof Problem) return backTo(state, { goodfellow_sign_in_error: error.problem });
					if (error instanceof GitHubError && error.status === 401) return backTo(state, { goodfellow_sign_in_error: "invalid" });
					return backTo(state, { goodfellow_sign_in_error: "unavailable" });
				}
			}
			if (request.method !== "POST") return json({ problem: "bad-request" }, 404);
			const body = await readBody();
			if (path === "/github/session") {
				const grant = await (await sealer()).open("grant", body.grant);
				if (!grant || typeof body.verifier !== "string") throw new Problem("invalid", 401);
				if (grant.origin !== requestOrigin) throw new Problem("wrong-address", 403);
				if (await challengeFor(body.verifier) !== grant.challenge) throw new Problem("invalid", 401);
				if (grant.purpose === "setup" && "code" in grant) {
					const { challenge: _, code, ...rest } = grant;
					const tokens = await userTokens(config, appFor("setup"), {
						code,
						redirectUri: `${url.origin}/github/callback`
					}, now()).catch((error) => {
						throw error instanceof GitHubError ? new Problem("invalid", 401) : error;
					});
					const session = {
						...rest,
						user: await signedInUser(tokens.access),
						tokens
					};
					return json({
						session: await sealSession(session),
						user: publicUser(session.user)
					});
				}
				const { challenge: _, ...session } = grant;
				return json(await issue(session, body.code));
			}
			if (path === "/github/token") return json(await issue(await openSession(body), body.code));
			if (path.startsWith("/github/setup/")) return await setupRoute(path, body).catch((error) => {
				if (error instanceof GitHubError && error.status === 401) throw new Problem("invalid", 401);
				throw error;
			});
			return json({ problem: "bad-request" }, 404);
		} catch (error) {
			if (error instanceof Problem) return json({
				problem: error.problem,
				...error.extra
			}, error.status);
			return json({ problem: "unavailable" }, 502);
		}
		/** The setup page's requests, made with the person's own token, which its session keeps for half an hour. */
		async function setupRoute(path, body) {
			checkSetupOrigin(requestOrigin);
			const session = await openSession(body, "setup");
			const tokens = session.tokens;
			if (!tokens) throw new Problem("invalid", 401);
			const renewed = body.session;
			const auth = { bearer: tokens.access };
			const app = appFor("setup");
			if (path === "/github/setup/owners") {
				const found = await userInstallations(tokens.access);
				const own = found.find((item) => item.account.login.toLowerCase() === session.user.login.toLowerCase());
				return json({
					session: renewed,
					user: publicUser(session.user),
					installUrl: installUrl(app),
					owners: [{
						path: session.user.login,
						name: session.user.name || session.user.login,
						kind: "personal",
						installed: Boolean(own)
					}, ...found.filter((item) => item.account.type === "Organization").map((item) => ({
						path: item.account.login,
						name: item.account.login,
						kind: "organization",
						installed: true
					}))]
				});
			}
			const owner = typeof body.owner === "string" ? body.owner : "";
			const name = typeof body.name === "string" ? body.name : "";
			if (!REPO.test(`${owner}/${name}`)) throw new Problem("name-invalid", 400);
			if (path === "/github/setup/available") try {
				await github(config, `/repos/${repoPath(`${owner}/${name}`)}`, { auth });
				return json({
					session: renewed,
					available: false
				});
			} catch (error) {
				if (error instanceof GitHubError && (error.status === 404 || error.status === 403)) return json({
					session: renewed,
					available: true
				});
				throw error;
			}
			if (path === "/github/setup/repository") {
				const installation = (await userInstallations(tokens.access)).find((item) => item.account.login.toLowerCase() === owner.toLowerCase());
				if (!installation) throw new Problem("not-installed", 409, { installUrl: installUrl(app) });
				let repo;
				try {
					repo = await githubJson(config, owner.toLowerCase() === session.user.login.toLowerCase() ? "/user/repos" : `/orgs/${encodeURIComponent(owner)}/repos`, {
						method: "POST",
						auth,
						body: {
							name,
							private: body.private === true,
							description: typeof body.description === "string" ? body.description : void 0,
							auto_init: true
						}
					});
				} catch (error) {
					if (error instanceof GitHubError && error.status === 422) {
						const said = JSON.stringify(error.body);
						throw new Problem(/already exists/i.test(said) ? "name-taken" : "name-invalid", 422);
					}
					if (error instanceof GitHubError && (error.status === 403 || error.status === 404)) throw new Problem("not-allowed", 403);
					throw error;
				}
				if (installation.repository_selection === "selected") await github(config, `/user/installations/${installation.id}/repositories/${repo.id}`, {
					method: "PUT",
					auth
				});
				const issued = await purposeToken(await jwtFor(app), installation.id, repo.full_name, "setup");
				const editApp = apps.edit;
				const editInstalled = editApp ? await installationFor(editApp, repo.full_name) !== void 0 : true;
				if (body.more !== true) await revokeUserToken(config, app, tokens.access).catch(() => {});
				return json({
					session: renewed,
					repo: {
						full_name: repo.full_name,
						html_url: repo.html_url,
						default_branch: repo.default_branch
					},
					token: issued.token,
					expiresAt: issued.expiresAt,
					...!editInstalled && editApp && { editInstallUrl: installUrl(editApp) }
				});
			}
			return json({ problem: "bad-request" }, 404);
		}
	}
	return { fetch: handle };
}
//#endregion
//#region src/index.ts
/** The worker as Cloudflare runs it: `wrangler deploy` reads `wrangler.jsonc`, which names this file. */
const worker = createWorker();
var src_default = { fetch(request, env) {
	return worker.fetch(request, env);
} };
//#endregion
export { src_default as default };
