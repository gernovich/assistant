import { type FetchInput, requestUrlFetch } from "./requestUrlFetch";

/**
 * `cross-fetch` compatible fetch that routes requests through Obsidian `requestUrl`
 * (no CORS restrictions in Obsidian/Electron renderer).
 */
export async function fetch(input: FetchInput, init?: RequestInit): Promise<Response> {
  return await requestUrlFetch(input, init);
}

export default fetch;
