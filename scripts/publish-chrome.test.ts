import { expect, test } from "bun:test";
import { publishChrome, validateCredentials } from "./publish-chrome";

const env = Object.fromEntries([
  "CHROME_PUBLISHER_ID", "CHROME_EXTENSION_ID", "CHROME_CLIENT_ID", "CHROME_CLIENT_SECRET",
  "CHROME_REFRESH_TOKEN", "AMO_JWT_ISSUER", "AMO_JWT_SECRET",
].map((key) => [key, "fixture"]));
const name = "publishers/fixture/items/fixture";

function api(responses: unknown[]) {
  const calls: { url: string; options?: RequestInit }[] = [];
  const request = (async (url: string, options?: RequestInit) => {
    calls.push({ url, options });
    if (!responses.length) throw new Error("Unexpected API request");
    const response = responses.shift();
    return response instanceof Response ? response : Response.json(response);
  }) as typeof fetch;
  return { calls, request };
}

test("requires complete credentials before either store can publish", () => {
  for (const key of Object.keys(env)) {
    expect(() => validateCredentials({ ...env, [key]: "" })).toThrow(key);
  }
  expect(() => validateCredentials({ ...env, CHROME_PUBLISHER_ID: "../other" })).toThrow();
});

test("uploads through V2, waits for processing, and validates submission", async () => {
  const mock = api([
    { access_token: "token" }, { name, uploadState: "IN_PROGRESS" },
    { name, lastAsyncUploadState: "SUCCEEDED" }, { name, state: "PENDING_REVIEW" },
  ]);
  await publishChrome(env, new Blob(["zip"]), mock.request, async () => {});
  expect(mock.calls.map((call) => call.url)).toEqual([
    "https://oauth2.googleapis.com/token",
    `https://chromewebstore.googleapis.com/upload/v2/${name}:upload`,
    `https://chromewebstore.googleapis.com/v2/${name}:fetchStatus`,
    `https://chromewebstore.googleapis.com/v2/${name}:publish`,
  ]);
  expect(JSON.parse(String(mock.calls[3]?.options?.body)).blockOnWarnings).toBe(true);
});

test("never submits a failed upload", async () => {
  const mock = api([{ access_token: "token" }, { name, uploadState: "FAILED" }]);
  await expect(publishChrome(env, new Blob(), mock.request)).rejects.toThrow("did not succeed");
  expect(mock.calls).toHaveLength(2);
});

test("rejects HTTP errors and unsuccessful publication responses", async () => {
  for (const response of [new Response("Unavailable", { status: 503 }), { name, state: "REJECTED" }, {}]) {
    const mock = api([{ access_token: "token" }, { name, uploadState: "SUCCEEDED" }, response]);
    await expect(publishChrome(env, new Blob(), mock.request)).rejects.toThrow();
  }
});

test("bounds asynchronous upload polling", async () => {
  const mock = api([
    { access_token: "token" }, { name, uploadState: "IN_PROGRESS" },
    ...Array.from({ length: 30 }, () => ({ name, lastAsyncUploadState: "IN_PROGRESS" })),
  ]);
  await expect(publishChrome(env, new Blob(), mock.request, async () => {})).rejects.toThrow("did not succeed");
  expect(mock.calls).toHaveLength(32);
});

test("reports API errors while redacting credentials and access tokens", async () => {
  const mock = api([
    { access_token: "private-access-token" },
    { name, uploadState: "SUCCEEDED" },
    Response.json({ error: { message: "Publication blocked: fixture private-access-token" } }, { status: 400 }),
  ]);
  try {
    await publishChrome(env, new Blob(), mock.request);
    throw new Error("Expected publication to fail");
  } catch (error) {
    const message = String(error);
    expect(message).toContain("HTTP 400: Publication blocked:");
    expect(message).not.toContain("fixture");
    expect(message).not.toContain("private-access-token");
    expect(message).toContain("[redacted]");
  }
});
