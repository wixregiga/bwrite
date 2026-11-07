// Replacing a file so a reader sees the old text or the new, never a part: the text is written
// and synced to a temporary file beside it, which is then renamed over the file.

import { randomBytes } from "node:crypto";
import { open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

export async function writeAtomically(file: string, text: string): Promise<void> {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  let mode = 0o644;
  try {
    mode = (await stat(file)).mode & 0o777;
  } catch {
    // A new file takes the default mode.
  }
  const handle = await open(temporary, "wx", mode);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
