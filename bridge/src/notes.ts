import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { config } from './config.js';
import { ValidationError } from './garage.js';
import { MUTATION_NAME_RE } from './catalog.js';

/**
 * Admin-written descriptions of mutations, shown on hover in the panel.
 *
 * The game gives us mutation NAMES ("Reniculate Kidneys") and nothing else.
 * The panel shows the community reference (mutation-reference.ts) by default;
 * a note here is the admins' own text for this server and takes precedence.
 *
 *   <MUTATION_NOTES_PATH>   { "Reniculate Kidneys": { "description": "...", "updatedAt": 1790000000 } }
 */

export interface MutationNote {
  description: string;
  updatedAt: number;
}

const MAX_DESCRIPTION = 500;

export async function readNotes(): Promise<Record<string, MutationNote>> {
  try {
    const data = JSON.parse(await readFile(config.mutationNotesPath, 'utf8')) as unknown;
    return typeof data === 'object' && data !== null ? (data as Record<string, MutationNote>) : {};
  } catch {
    return {};
  }
}

let queue: Promise<unknown> = Promise.resolve();

/** Set (or, with an empty text, clear) one mutation's description. */
export async function setNote(name: string, raw: unknown): Promise<MutationNote | null> {
  if (!MUTATION_NAME_RE.test(name)) {
    throw new ValidationError('mutation name must be letters, digits, spaces, _ or -');
  }
  if (typeof raw !== 'string') throw new ValidationError('description must be text');
  // Newlines are fine in a tooltip; other control characters are not.
  const description = raw.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim();
  if (description.length > MAX_DESCRIPTION) {
    throw new ValidationError(`description is limited to ${MAX_DESCRIPTION} characters`);
  }

  const run = queue.then(async () => {
    const notes = await readNotes();
    let note: MutationNote | null = null;
    if (description === '') {
      delete notes[name];
    } else {
      note = { description, updatedAt: Math.floor(Date.now() / 1000) };
      notes[name] = note;
    }
    await mkdir(dirname(config.mutationNotesPath), { recursive: true });
    const tmp = `${config.mutationNotesPath}.tmp`;
    await writeFile(tmp, JSON.stringify(notes, null, 2), 'utf8');
    await rename(tmp, config.mutationNotesPath);
    return note;
  });
  queue = run.catch(() => undefined);
  return run;
}
