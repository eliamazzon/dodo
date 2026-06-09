// IndexedDB-backed history store (via Dexie). This is the ONLY module that knows about Dexie —
// everything else goes through store.ts, which delegates to `historyRepo`. Keeping Dexie behind
// this seam (and records as plain JSON) means a future swap to another backend — or a cloud sync
// layer — is a contained change. We use only the open-source Dexie library; NOT dexie-cloud-addon.
//
// Two stores: `history` holds list METADATA only (title/status/steps/times), `conversations` holds
// the heavy `state`/`conversation` blobs keyed by the same id. The frequent list/broadcast path
// touches only the tiny metadata store; the heavy body is loaded on demand when a row is opened.
import Dexie, { type Table } from 'dexie';
import type { HistoryItem, HistoryStatus, AgentState, SavedConversationMessage } from '../shared/types';

export const HISTORY_MAX = 200; // oldest rows are pruned once this cap is reached

// The heavy half of a HistoryItem, stored apart from the list metadata. Keyed by the item id.
type HistoryBody = { id: string; state?: AgentState; conversation?: SavedConversationMessage[] };

function splitItem(item: HistoryItem): { meta: HistoryItem; body: HistoryBody } {
  const { state, conversation, ...meta } = item;
  return { meta: meta as HistoryItem, body: { id: item.id, state, conversation } };
}

class DodoDB extends Dexie {
  history!: Table<HistoryItem, string>;       // metadata only (state/conversation stripped)
  conversations!: Table<HistoryBody, string>; // heavy fields, keyed by the same id

  constructor() {
    super('dodo');
    // v1 stored the full item (incl. conversation/state) in `history`.
    this.version(1).stores({ history: 'id, startedAt, status' });
    // v2 splits the heavy fields into `conversations`, leaving `history` as a lightweight index.
    // version() + upgrade() is our forward migration story.
    this.version(2)
      .stores({ history: 'id, startedAt, status', conversations: 'id' })
      .upgrade(async (tx) => {
        const hist = tx.table<HistoryItem & HistoryBody, string>('history');
        const conv = tx.table<HistoryBody, string>('conversations');
        const rows = await hist.toArray();
        const bodies = rows
          .filter((r) => r.state !== undefined || r.conversation !== undefined)
          .map((r) => ({ id: r.id, state: r.state, conversation: r.conversation }));
        if (bodies.length) await conv.bulkPut(bodies);
        await hist.toCollection().modify((row) => {
          delete row.state;
          delete row.conversation;
        });
      });
  }
}

const db = new DodoDB();

// One-time migration: lift any legacy `history` array out of chrome.storage.local into IndexedDB
// (splitting it across the two stores), then drop the old key. Idempotent — a missing/empty legacy
// key is a no-op. Gated on the migration promise so concurrent repo calls await the same migration.
let migration: Promise<void> | null = null;
function ensureMigrated(): Promise<void> {
  if (!migration) {
    migration = (async () => {
      try {
        const raw = await chrome.storage.local.get(['history']);
        const legacy = raw.history as HistoryItem[] | undefined;
        if (Array.isArray(legacy) && legacy.length > 0) {
          const metas: HistoryItem[] = [];
          const bodies: HistoryBody[] = [];
          for (const it of legacy) {
            const { meta, body } = splitItem(it);
            metas.push(meta);
            bodies.push(body);
          }
          await db.transaction('rw', db.history, db.conversations, async () => {
            await db.history.bulkPut(metas);
            await db.conversations.bulkPut(bodies);
          });
        }
        if (legacy !== undefined) {
          await chrome.storage.local.remove('history');
        }
      } catch {
        // Best-effort — a failed migration shouldn't wedge the store; the repo still works on
        // the (possibly empty) Dexie tables, and the legacy key is left for a later retry.
      }
    })();
  }
  return migration;
}

async function pruneToCap(): Promise<void> {
  const count = await db.history.count();
  if (count <= HISTORY_MAX) return;
  // Oldest-first, drop everything beyond the cap — from both stores.
  const stale = await db.history.orderBy('startedAt').limit(count - HISTORY_MAX).primaryKeys();
  if (!stale.length) return;
  await db.transaction('rw', db.history, db.conversations, async () => {
    await db.history.bulkDelete(stale);
    await db.conversations.bulkDelete(stale);
  });
}

export const historyRepo = {
  // Metadata only — the `history` store no longer holds conversation/state, so this is cheap to
  // call on the frequent broadcast path even as history grows.
  async list(opts?: { limit?: number; status?: HistoryStatus }): Promise<HistoryItem[]> {
    await ensureMigrated();
    const limit = opts?.limit ?? HISTORY_MAX;
    let coll = db.history.orderBy('startedAt').reverse();
    if (opts?.status) coll = coll.filter((it) => it.status === opts.status);
    return coll.limit(limit).toArray();
  },

  // Full item — merges the metadata row with its heavy body. Used when a history row is opened.
  async get(id: string): Promise<HistoryItem | undefined> {
    await ensureMigrated();
    const meta = await db.history.get(id);
    if (!meta) return undefined;
    const body = await db.conversations.get(id);
    return { ...meta, state: body?.state, conversation: body?.conversation };
  },

  async upsert(item: HistoryItem): Promise<void> {
    await ensureMigrated();
    const { meta, body } = splitItem(item);
    await db.transaction('rw', db.history, db.conversations, async () => {
      await db.history.put(meta);
      await db.conversations.put(body);
    });
    await pruneToCap();
  },

  async remove(id: string): Promise<void> {
    await ensureMigrated();
    await db.transaction('rw', db.history, db.conversations, async () => {
      await db.history.delete(id);
      await db.conversations.delete(id);
    });
  },
};
