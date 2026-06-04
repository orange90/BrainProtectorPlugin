/**
 * src/db.js — 共享 IndexedDB 数据层
 *
 * 同时被 Service Worker(importScripts) 与各页面(<script>)加载，
 * 因此所有 API 挂载在 globalThis.BPDB 上，两端共用同一个数据库。
 *
 * 数据完全本地，不上传任何服务器。
 */
(function (global) {
  'use strict';

  const DB_NAME = 'BrainProtector';
  const DB_VERSION = 1;
  const STORE_RECORDS = 'records';   // 时间记录条目
  const STORE_SESSIONS = 'sessions'; // 专注会话记录

  let _dbPromise = null;

  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_RECORDS)) {
          const s = db.createObjectStore(STORE_RECORDS, { keyPath: 'id' });
          s.createIndex('day', 'day', { unique: false });
          s.createIndex('domain', 'domain', { unique: false });
          s.createIndex('time_type', 'time_type', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
          const s = db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
          s.createIndex('day', 'day', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return _dbPromise;
  }

  function tx(store, mode) {
    return openDB().then((db) => db.transaction(store, mode).objectStore(store));
  }

  function reqToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /** 把 Unix ms 转为本地日期键 YYYY-MM-DD */
  function dayKey(ts) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function todayKey() {
    return dayKey(Date.now());
  }

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  async function putRecord(rec) {
    if (!rec.id) rec.id = uuid();
    if (!rec.day) rec.day = dayKey(rec.start_at || Date.now());
    const store = await tx(STORE_RECORDS, 'readwrite');
    await reqToPromise(store.put(rec));
    return rec;
  }

  async function getRecordsByDay(day) {
    const store = await tx(STORE_RECORDS, 'readonly');
    return reqToPromise(store.index('day').getAll(IDBKeyRange.only(day)));
  }

  async function getRecordsInRange(startDay, endDay) {
    const store = await tx(STORE_RECORDS, 'readonly');
    return reqToPromise(store.index('day').getAll(IDBKeyRange.bound(startDay, endDay)));
  }

  async function getAllRecords() {
    const store = await tx(STORE_RECORDS, 'readonly');
    return reqToPromise(store.getAll());
  }

  async function putSession(session) {
    if (!session.id) session.id = uuid();
    if (!session.day) session.day = dayKey(session.end_at || Date.now());
    const store = await tx(STORE_SESSIONS, 'readwrite');
    await reqToPromise(store.put(session));
    return session;
  }

  async function getSessionsByDay(day) {
    const store = await tx(STORE_SESSIONS, 'readonly');
    return reqToPromise(store.index('day').getAll(IDBKeyRange.only(day)));
  }

  async function clearAll() {
    const db = await openDB();
    await Promise.all([STORE_RECORDS, STORE_SESSIONS].map((name) =>
      reqToPromise(db.transaction(name, 'readwrite').objectStore(name).clear())
    ));
  }

  global.BPDB = {
    openDB,
    putRecord,
    getRecordsByDay,
    getRecordsInRange,
    getAllRecords,
    putSession,
    getSessionsByDay,
    clearAll,
    dayKey,
    todayKey,
    uuid,
  };
})(typeof self !== 'undefined' ? self : this);
