import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocFromServer, getDocs, collection, setDoc, updateDoc, deleteDoc, writeBatch, runTransaction, type Firestore } from 'firebase/firestore';

const projectId = 'demo-si-ledger';
const agency = 'saman-indika';
const prefix = `agencies/${agency}`;
const timestamp = '2026-11-23T04:30:00.000Z';
let env: RulesTestEnvironment;
const member = (uid = 'phone-a', agencyId = agency) => env.authenticatedContext(uid, { agencyId }).firestore();
const invoice = (uid = 'phone-a', id = 'invoice-a', seq = 1) => ({
  id, kind: 'invoice', date: '2026-11-23', createdAt: timestamp,
  operatorId: 'me', deviceId: 'local-phone-a', shopId: 'shop-a', authUid: uid,
  serverSequence: seq, disposition: 'applied', reference: `LKM-${id}`,
  total: 2500000, cash: 1000000, dueDate: '2026-11-30', photoIds: [],
  cheques: [{ id: `cheque-${id}`, bank: 'Bank of Ceylon', number: `028491-${id}`, amount: 500000, date: '2026-11-25', photoIds: [] }],
});
const shop = (uid = 'phone-a') => ({ id: 'shop-a', name: 'Rathna Stores', village: 'Kaduruwela', route: 'Kaduruwela', phone: '077 234 5678', authUid: uid, updatedAt: timestamp });
async function append(db: Firestore, data: Record<string, unknown>) {
  const batch = writeBatch(db);
  batch.set(doc(db, `${prefix}/events/${data.id}`), data);
  batch.update(doc(db, `${prefix}/sync/head`), { sequence: data.serverSequence, lastEventId: data.id });
  await batch.commit();
}

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Firestore agency boundary and immutable ledger rules', () => {
  beforeAll(async () => {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
    env = await initializeTestEnvironment({ projectId, firestore: { host, port: Number(port), rules: readFileSync('firestore.rules', 'utf8') } });
  }, 30000);
  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore();
      await setDoc(doc(db, prefix), { name: 'Saman Indika Ledger' });
      await setDoc(doc(db, `${prefix}/sync/head`), { sequence: 0, lastEventId: '' });
      await setDoc(doc(db, `${prefix}/devices/phone-a`), { active: true, label: 'Owner phone' });
      await setDoc(doc(db, `${prefix}/devices/phone-b`), { active: true, label: 'Brother phone' });
      await setDoc(doc(db, `${prefix}/devices/revoked-phone`), { active: false, label: 'Lost phone' });
      await setDoc(doc(db, `${prefix}/shops/shop-a`), shop());
    });
  });
  afterAll(async () => { await env?.cleanup(); });

  it('denies public reads, lists, writes and profile-based self-enrollment', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, `${prefix}/shops/shop-a`)));
    await assertFails(getDocs(collection(db, `${prefix}/events`)));
    await assertFails(setDoc(doc(db, `${prefix}/devices/attacker`), { active: true, operatorId: 'me' }));
    await assertFails(append(db, invoice('attacker')));
  });
  it('denies authenticated but unenrolled, revoked, or wrong-agency devices', async () => {
    for (const db of [member('unknown'), member('revoked-phone'), member('phone-a', 'different-agency')]) {
      await assertFails(getDoc(doc(db, `${prefix}/shops/shop-a`)));
      await assertFails(append(db, invoice()));
    }
  });
  it('prevents any client from creating or modifying agency access', async () => {
    const db = member();
    await assertFails(setDoc(doc(db, `${prefix}/devices/new-phone`), { active: true }));
    await assertFails(updateDoc(doc(db, `${prefix}/devices/revoked-phone`), { active: true }));
    await assertFails(updateDoc(doc(db, prefix), { ownerUid: 'phone-a' }));
    await assertFails(deleteDoc(doc(db, `${prefix}/devices/phone-b`)));
    await assertSucceeds(getDoc(doc(db, `${prefix}/devices/phone-a`)));
    await assertFails(getDoc(doc(db, `${prefix}/devices/phone-b`)));
  });
  it('allows both enrolled devices to read agency data and append independently', async () => {
    await assertSucceeds(append(member(), invoice()));
    await assertSucceeds(append(member('phone-b'), invoice('phone-b', 'invoice-b', 2)));
    const snapshot = await assertSucceeds(getDocs(collection(member('phone-b'), `${prefix}/events`)));
    expect(snapshot.size).toBe(2);
    await assertSucceeds(getDocs(collection(member(), `${prefix}/shops`)));
  });
  it('requires event and head to be atomic, with no standalone counter increment', async () => {
    const db = member();
    await assertFails(setDoc(doc(db, `${prefix}/events/invoice-a`), invoice()));
    await assertFails(updateDoc(doc(db, `${prefix}/sync/head`), { sequence: 1, lastEventId: 'invoice-a' }));
    await assertFails(append(db, invoice('phone-a', 'invoice-a', 2)));
    await assertSucceeds(append(db, invoice()));
    await assertFails(updateDoc(doc(db, `${prefix}/sync/head`), { sequence: 2, lastEventId: 'invoice-a' }));
  });
  it('denies rewriting, deleting, or replaying immutable events', async () => {
    const db = member();
    await append(db, invoice());
    await assertFails(updateDoc(doc(db, `${prefix}/events/invoice-a`), { cash: 0 }));
    await assertFails(deleteDoc(doc(db, `${prefix}/events/invoice-a`)));
    await assertFails(append(db, { ...invoice(), serverSequence: 2 }));
  });
  it('rejects identity spoofing, unexpected fields, invalid types and missing fields', async () => {
    const db = member();
    await assertFails(append(db, invoice('phone-b')));
    await assertFails(append(db, { ...invoice(), operatorId: 'admin' }));
    await assertFails(append(db, { ...invoice(), isAdmin: true }));
    await assertFails(append(db, { ...invoice(), cash: '1000000' }));
    await assertFails(append(db, { ...invoice(), total: -1 }));
    await assertFails(append(db, { ...invoice(), total: 100000000000 }));
    const missing: Record<string, unknown> = invoice(); delete missing.reference;
    await assertFails(append(db, missing));
  });
  it('validates nested cheque, allocation, and photo arrays', async () => {
    const db = member();
    await assertFails(append(db, { ...invoice(), photoIds: [{ url: 'anything' }] }));
    await assertFails(append(db, { ...invoice(), photoIds: ['a', 'b', 'c', 'd', 'e', 'f'] }));
    await assertFails(append(db, { ...invoice(), cheques: [{ ...invoice().cheques[0], amount: -1 }] }));
    await assertFails(append(db, { ...invoice(), cheques: [{ ...invoice().cheques[0], bank: 'x'.repeat(121) }] }));
    const base = invoice();
    const collectionEvent = { id: base.id, kind: 'collection', date: base.date, createdAt: base.createdAt,
      operatorId: base.operatorId, deviceId: base.deviceId, shopId: base.shopId, authUid: base.authUid,
      serverSequence: 1, disposition: 'applied', cash: 300000, cheques: [], photoIds: [],
      allocations: [{ invoiceId: 'previous-invoice', cash: 300000, chequeAmounts: [] }] };
    await assertFails(append(db, { ...collectionEvent, allocations: [{ invoiceId: 'previous-invoice', cash: -1, chequeAmounts: [] }] }));
    await assertFails(append(db, { ...collectionEvent, allocations: [{ invoiceId: 'previous-invoice', cash: 300000, chequeAmounts: [{ chequeId: 'x', amount: 'bad' }] }] }));
  });
  it('retains syntactically valid conflict submissions without granting access to other paths', async () => {
    const data = { ...invoice(), disposition: 'conflict', conflictReason: 'Another device already collected this amount.' };
    await assertSucceeds(append(member(), data));
    await assertFails(setDoc(doc(member(), `${prefix}/balances/invoice-a`), { credit: 0 }));
    await assertFails(setDoc(doc(member(), 'arbitrary/path'), { active: true }));
  });
  it('validates shop creates and updates, preventing schema pollution and history deletion', async () => {
    const db = member();
    await assertSucceeds(setDoc(doc(db, `${prefix}/shops/shop-b`), { ...shop(), id: 'shop-b' }));
    await assertSucceeds(updateDoc(doc(db, `${prefix}/shops/shop-a`), { name: 'Rathna Super' }));
    await assertFails(updateDoc(doc(db, `${prefix}/shops/shop-a`), { name: 123 }));
    await assertFails(updateDoc(doc(db, `${prefix}/shops/shop-a`), { role: 'admin' }));
    await assertFails(updateDoc(doc(db, `${prefix}/shops/shop-a`), { notes: 'x'.repeat(2001) }));
    await assertFails(updateDoc(doc(db, `${prefix}/shops/shop-a`), { latitude: 91, longitude: 81 }));
    await assertFails(deleteDoc(doc(db, `${prefix}/shops/shop-a`)));
  });
  it('keeps original day-close figures immutable', async () => {
    const db = member();
    const close = { id: 'close-a', date: '2026-11-23', createdAt: timestamp, operatorId: 'me', deviceId: 'local-a', authUid: 'phone-a', countedCash: 1300000,
      snapshot: { invoiceValue: 2500000, newCredit: 1000000, cashFromInvoices: 1000000, cashFromCollections: 300000, expectedCash: 1300000, chequesReceived: 500000, chequesDeposited: 0, chequesCleared: 0, chequesReturned: 0 } };
    await assertSucceeds(setDoc(doc(db, `${prefix}/closes/close-a`), close));
    await assertFails(updateDoc(doc(db, `${prefix}/closes/close-a`), { countedCash: 0 }));
    await assertFails(deleteDoc(doc(db, `${prefix}/closes/close-a`)));
    await assertFails(setDoc(doc(db, `${prefix}/closes/close-b`), { ...close, id: 'close-b', snapshot: { ...close.snapshot, expectedCash: 1 } }));
  });
  it('blocks a previously active device immediately after membership revocation', async () => {
    const db = member();
    await assertSucceeds(getDoc(doc(db, `${prefix}/shops/shop-a`)));
    await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), `${prefix}/devices/phone-a`), { active: false }));
    await assertFails(append(db, invoice()));
    await assertFails(getDocs(collection(db, `${prefix}/events`)));
  });
  it('serializes simultaneous appends into unique server sequences', async () => {
    async function transactionAppend(uid: string, id: string) {
      const db = member(uid);
      const headRef = doc(db, `${prefix}/sync/head`);
      for (let attempt = 0; attempt < 6; attempt++) {
        let readSequence = -1;
        try {
          await runTransaction(db, async tx => {
            const head = await tx.get(headRef);
            readSequence = head.data()!.sequence;
            const sequence = readSequence + 1;
            tx.set(doc(db, `${prefix}/events/${id}`), invoice(uid, id, sequence));
            tx.update(headRef, { sequence, lastEventId: id });
          });
          return;
        } catch (error) {
          const head = await getDocFromServer(headRef);
          if ((error as { code?: string }).code !== 'permission-denied' || head.data()!.sequence === readSequence) throw error;
        }
      }
      throw new Error('Concurrent append did not converge');
    }
    await Promise.all([transactionAppend('phone-a', 'invoice-a'), transactionAppend('phone-b', 'invoice-b')]);
    const snapshot = await getDocs(collection(member(), `${prefix}/events`));
    expect(snapshot.docs.map(x => x.data().serverSequence).sort()).toEqual([1, 2]);
  });
});
