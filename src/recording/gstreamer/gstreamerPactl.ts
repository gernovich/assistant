import { execFile } from "node:child_process";

async function execFileText(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return await new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout) => {
      if (err) return resolve("");
      resolve(String(stdout ?? ""));
    });
  });
}

type PactlRow = { name: string; state: string };

async function pactlListShortSources(): Promise<PactlRow[]> {
  const out = await execFileText("pactl", ["list", "short", "sources"], 4000);
  const rows = out
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((row) => row.split(/\s+/).map((p) => p.trim()));
  return rows
    .map((parts) => ({ name: parts[1] ?? "", state: String(parts[parts.length - 1] ?? "").toUpperCase() }))
    .filter((x) => Boolean(x.name));
}

export async function listGStreamerRecordingSourcesViaPactl(): Promise<{ micSources: string[]; monitorSources: string[] }> {
  const rows = await pactlListShortSources();
  const micSources = rows.filter((x) => !x.name.endsWith(".monitor")).map((x) => x.name);
  const monitorSources = rows.filter((x) => x.name.endsWith(".monitor")).map((x) => x.name);
  return { micSources, monitorSources };
}

export async function pickMicFromPactl(): Promise<string> {
  const rows = await pactlListShortSources();
  const mics = rows.filter((x) => !x.name.endsWith(".monitor"));
  const running = mics.find((x) => x.state === "RUNNING");
  if (running) return running.name;
  const idle = mics.find((x) => x.state === "IDLE");
  if (idle) return idle.name;
  return mics[0]?.name ?? "";
}

export async function pickMonitorFromPactl(): Promise<string> {
  const rows = await pactlListShortSources();
  const monitors = rows.filter((x) => x.name.endsWith(".monitor"));
  const running = monitors.find((x) => x.state === "RUNNING");
  if (running) return running.name;
  const idle = monitors.find((x) => x.state === "IDLE");
  if (idle) return idle.name;
  return monitors[0]?.name ?? "";
}

