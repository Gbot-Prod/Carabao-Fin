// TLS settings for the Postgres pool (lib/auth.ts and scripts/better-auth-migrate.mjs).
// Plain .mjs so the Node migrate script can import it without a TypeScript step.
//
// The server certificate is always verified (rejectUnauthorized: true):
//   PGSSL_CA          PEM of the CA that signed the server cert. Literal "\n"
//                     escapes are accepted, so it fits in one env line.
//                     Without it, Node's public CA list is used.
//   PGSSL_SERVERNAME  Name the cert must carry, when it is not the host in the
//                     URL. Railway's TCP proxy serves a cert for "localhost"
//                     signed by a per-database "root-ca", so there it is
//                     "localhost" with PGSSL_CA set to that root-ca.
// A database on localhost / 127.0.0.1 / ::1 connects without TLS (local dev).

import tls from "node:tls";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const readCa = (env) => {
  const raw = (env.PGSSL_CA || "").trim().replace(/^"|"$/g, "");
  if (!raw) return undefined;
  const pem = raw.replace(/\\n/g, "\n");
  if (!pem.includes("-----BEGIN CERTIFICATE-----")) {
    throw new Error("PGSSL_CA must be a PEM certificate (-----BEGIN CERTIFICATE-----).");
  }
  return pem;
};

/**
 * One pg Pool config from a postgres:// URL. Throws on a URL it can't parse:
 * there is no second, less strict path.
 * @param {string} url
 * @param {Record<string, string | undefined>} [env]
 */
export function poolConfigFromUrl(url, env = process.env) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error("The Postgres URL could not be parsed. Use postgres://user:password@host:port/database.");
  }
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const servername = (env.PGSSL_SERVERNAME || "").trim() || undefined;
  const ssl = LOCAL_HOSTS.has(host)
    ? false
    : {
        rejectUnauthorized: true,
        ca: readCa(env),
        ...(servername
          ? { checkServerIdentity: (_host, cert) => tls.checkServerIdentity(servername, cert) }
          : {}),
      };
  return {
    host,
    port: Number(u.port) || 5432,
    database: decodeURIComponent(u.pathname.replace(/^\//, "")),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    ssl,
  };
}
