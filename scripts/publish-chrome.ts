import { readFile } from "node:fs/promises";

export function validateCredentials(env: NodeJS.ProcessEnv) {
  for (const name of [
    "CHROME_PUBLISHER_ID",
    "CHROME_EXTENSION_ID",
    "CHROME_CLIENT_ID",
    "CHROME_CLIENT_SECRET",
    "CHROME_REFRESH_TOKEN",
    "AMO_JWT_ISSUER",
    "AMO_JWT_SECRET",
  ]) {
    if (!env[name]?.trim()) throw new Error(`Missing required configuration: ${name}`);
  }
  for (const name of ["CHROME_PUBLISHER_ID", "CHROME_EXTENSION_ID"]) {
    if (!/^[a-zA-Z0-9_-]+$/.test(env[name]!)) throw new Error(`Invalid configuration: ${name}`);
  }
}

export async function publishChrome(
  env: NodeJS.ProcessEnv,
  archive: Blob,
  request: typeof fetch = fetch,
  pause: (milliseconds: number) => Promise<void> = Bun.sleep,
) {
  validateCredentials(env);
  const sensitiveValues = [
    env.CHROME_CLIENT_ID, env.CHROME_CLIENT_SECRET, env.CHROME_REFRESH_TOKEN,
    env.AMO_JWT_ISSUER, env.AMO_JWT_SECRET,
  ].filter((value): value is string => Boolean(value));
  const json = async (url: string, options: RequestInit = {}) => {
    const response = await request(url, { ...options, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      let detail = "";
      try {
        const body = await response.json();
        if (typeof body?.error === "string") {
          detail = body.error;
          if (typeof body.error_description === "string") detail += `: ${body.error_description}`;
        } else if (typeof body?.error?.message === "string") {
          detail = body.error.message;
        }
      } catch {}
      for (const value of sensitiveValues) detail = detail.split(value).join("[redacted]");
      throw new Error(`Chrome Web Store request failed: HTTP ${response.status}${detail ? `: ${detail.slice(0, 2000)}` : ""}`);
    }
    const result = await response.json();
    if (!result || typeof result !== "object" || result.error) throw new Error("Invalid Chrome Web Store response");
    return result;
  };
  const token = await json("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: env.CHROME_CLIENT_ID!,
      client_secret: env.CHROME_CLIENT_SECRET!,
      refresh_token: env.CHROME_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  if (typeof token.access_token !== "string" || !token.access_token) throw new Error("Could not obtain an access token");
  sensitiveValues.push(token.access_token);
  const headers = { Authorization: `Bearer ${token.access_token}` };
  const name = `publishers/${env.CHROME_PUBLISHER_ID}/items/${env.CHROME_EXTENSION_ID}`;
  const base = `https://chromewebstore.googleapis.com/v2/${name}`;
  const upload = await json(`https://chromewebstore.googleapis.com/upload/v2/${name}:upload`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/zip" },
    body: archive,
  });
  if (upload.name !== name) throw new Error("Upload response identifies a different extension");
  let state = upload.uploadState;
  for (let attempt = 0; state === "IN_PROGRESS" && attempt < 30; attempt++) {
    await pause(5_000);
    const status = await json(`${base}:fetchStatus`, { headers });
    if (status.name !== name) throw new Error("Status response identifies a different extension");
    state = status.lastAsyncUploadState;
  }
  if (state !== "SUCCEEDED") throw new Error(`Chrome upload did not succeed: ${state}`);
  const publication = await json(`${base}:publish`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ publishType: "DEFAULT_PUBLISH", blockOnWarnings: true }),
  });
  if (publication.name !== name || !["PENDING_REVIEW", "PUBLISHED"].includes(publication.state)) {
    throw new Error(`Chrome submission was not accepted: ${publication.state}`);
  }
  console.log(`Chrome Web Store submission: ${publication.state}`);
}

if (import.meta.main) {
  validateCredentials(process.env);
  if (process.argv[2] !== "--check") {
    await publishChrome(process.env, new Blob([await readFile("chrome.zip")]));
  }
}
