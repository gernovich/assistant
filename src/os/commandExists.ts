export async function commandExists(cmd: string): Promise<boolean> {
  if (!cmd) return false;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { execFile } = require("child_process") as typeof import("child_process");

  return await new Promise<boolean>((resolve) => {
    execFile("sh", ["-lc", `command -v ${shellEscape(cmd)} >/dev/null 2>&1`], { timeout: 2000 }, (err: unknown) => {
      resolve(!err);
    });
  });
}

function shellEscape(s: string): string {
  return `'${String(s).replace(/'/g, `'\"'\"'`)}'`;
}
