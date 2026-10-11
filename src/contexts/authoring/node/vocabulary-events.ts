// Server-sent events telling the page that a Project's VocabularyFile changed on disk. One
// watcher per watched file, shared by every connection that listens for it. The watcher
// follows the file's folder rather than the file, so an editor that saves by writing a new
// file and renaming it over the old one, or a file created after the page connected, is
// still seen. Bursts of file system events are debounced into one message.

import { watch, type FSWatcher } from "node:fs";
import type { ServerResponse } from "node:http";
import path from "node:path";
import { VOCABULARY_CHANGED } from "../contracts/vocabulary-api";

const DEBOUNCE_MS = 150;
const HEARTBEAT_MS = 25_000;

interface Listener {
  response: ServerResponse;
  /** The path the page asked about, echoed in each message. */
  path: string;
}

interface Watch {
  watcher: FSWatcher;
  listeners: Set<Listener>;
  timer: NodeJS.Timeout | undefined;
}

export class VocabularyEvents {
  private readonly watches = new Map<string, Watch>();
  private readonly heartbeat: NodeJS.Timeout;

  constructor() {
    this.heartbeat = setInterval(() => {
      for (const entry of this.watches.values()) for (const listener of entry.listeners) listener.response.write(": keep-alive\n\n");
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  /** Streams VOCABULARY_CHANGED to `response` whenever `file` changes, until the connection closes. */
  listen(file: string, requestedPath: string, response: ServerResponse): void {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff",
    });
    response.write("retry: 2000\n\n");
    response.flushHeaders();
    const entry = this.watchFor(file);
    const listener: Listener = { response, path: requestedPath };
    entry.listeners.add(listener);
    const stop = () => {
      entry.listeners.delete(listener);
      if (entry.listeners.size === 0) this.unwatch(file);
    };
    response.on("close", stop);
    response.on("error", stop);
  }

  /** How many files are being watched; zero once every connection has closed. */
  get watchedFiles(): number {
    return this.watches.size;
  }

  private watchFor(file: string): Watch {
    const existing = this.watches.get(file);
    if (existing) return existing;
    const name = path.basename(file);
    const watcher = watch(path.dirname(file), { persistent: false });
    const entry: Watch = { watcher, listeners: new Set(), timer: undefined };
    watcher.on("change", (_event, changed) => {
      if (changed !== null && changed.toString() !== name) return;
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => this.notify(entry), DEBOUNCE_MS);
    });
    watcher.on("error", () => {
      for (const listener of entry.listeners) listener.response.end();
      this.unwatch(file);
    });
    this.watches.set(file, entry);
    return entry;
  }

  private notify(entry: Watch): void {
    for (const listener of entry.listeners) {
      listener.response.write(`event: ${VOCABULARY_CHANGED}\ndata: ${JSON.stringify({ path: listener.path })}\n\n`);
    }
  }

  private unwatch(file: string): void {
    const entry = this.watches.get(file);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.watcher.close();
    this.watches.delete(file);
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const [file, entry] of [...this.watches]) {
      for (const listener of entry.listeners) listener.response.end();
      this.unwatch(file);
    }
  }
}
