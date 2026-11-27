// Obsidian Prism - inject.js Ch17 projectPartitions 绑定鉴权与安全广播辅助（L1 CJS，零环依赖）
'use strict';

const { serializeJsonForEval } = require('../utils/fs-safe.cjs');

const PARTITIONS_MAX_PAYLOAD_BYTES = 65536;

async function removePartitionsBinding(session, entry, bindingName) {
  if (!bindingName || !session || session.closed || !entry || !entry.projectPartitionsBindingAdded) return;
  await session.send('Runtime.removeBinding', { name: bindingName }).catch(() => {});
  entry.projectPartitionsBindingAdded = false;
}

async function ensurePartitionsBinding(session, entry, cfg, bindingName) {
  if (!bindingName || !session || session.closed || !entry) return false;
  if (cfg?.projectPartitions !== 'on' && cfg?.projectPartitions !== true) {
    await removePartitionsBinding(session, entry, bindingName);
    return false;
  }
  if (entry.sidebarHostVerified !== true) return false;
  if (entry.projectPartitionsBindingAdded) return true;
  if (entry.projectPartitionsBindingPending) return entry.projectPartitionsBindingPending;
  const pending = session
    .send('Runtime.addBinding', { name: bindingName })
    .then(() => {
      entry.projectPartitionsBindingAdded = true;
      return true;
    })
    .catch(() => false)
    .finally(() => {
      if (entry.projectPartitionsBindingPending === pending) entry.projectPartitionsBindingPending = null;
    });
  entry.projectPartitionsBindingPending = pending;
  return pending;
}

function resolveTrustedPeerContextId(other) {
  if (!other || other.session?.closed || other.sidebarHostVerified !== true) return null;
  if (!other.mainFrameId || !(other.contextFrames instanceof Map)) return null;
  let targetCtxId = null;
  for (const [cid, meta] of other.contextFrames.entries()) {
    if (
      meta &&
      meta.isDefault === true &&
      (!meta.type || meta.type === 'default') &&
      meta.frameId === other.mainFrameId &&
      meta.docGen === other.docGen
    ) {
      targetCtxId = cid;
    }
  }
  return typeof targetCtxId === 'number' ? targetCtxId : null;
}

async function handlePartitionsBindingCall({
  session,
  entry,
  payload,
  executionContextId,
  attached,
  isTrustedMainFrameContext,
  readConfig,
  readProjectPartitionsData,
  writeProjectPartitionsData,
}) {
  const context = typeof executionContextId === 'number' ? entry?.contextFrames?.get(executionContextId) : undefined;
  const expectedDocGen = entry?.docGen;
  const isCurrentContext = () =>
    Boolean(
      session &&
        !session.closed &&
        entry &&
        entry.sidebarHostVerified === true &&
        typeof isTrustedMainFrameContext === 'function' &&
        isTrustedMainFrameContext(entry, executionContextId) &&
        context &&
        entry.contextFrames.get(executionContextId) === context &&
        entry.docGen === expectedDocGen &&
        context.docGen === entry.docGen
    );
  if (!isCurrentContext()) return false;
  const cfgNow = typeof readConfig === 'function' ? readConfig() : null;
  if (cfgNow?.projectPartitions !== 'on' && cfgNow?.projectPartitions !== true) return false;
  if (
    typeof payload !== 'string' ||
    payload.length > PARTITIONS_MAX_PAYLOAD_BYTES ||
    Buffer.byteLength(payload, 'utf8') > PARTITIONS_MAX_PAYLOAD_BYTES
  ) {
    return false;
  }
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const act = typeof parsed.action === 'string' ? parsed.action.trim() : '';
  const mkApplyExpr = (dataObj, exists) =>
    `(() => { try { (window.__agPrismProjectPartitions || globalThis.__agPrismProjectPartitions)?.applyPersistedState?.(${serializeJsonForEval(dataObj)}, ${Boolean(exists)}); } catch {} })();void 0`;

  if (act === 'load' && typeof readProjectPartitionsData === 'function') {
    const res = readProjectPartitionsData();
    if (!isCurrentContext()) return false;
    await session
      .send('Runtime.evaluate', {
        expression: mkApplyExpr(res.data, res.exists),
        contextId: executionContextId,
        returnByValue: false,
        awaitPromise: false,
      })
      .catch(() => {});
    return true;
  }
  if (act === 'save' && typeof writeProjectPartitionsData === 'function') {
    let saved;
    try {
      saved = writeProjectPartitionsData(parsed.data);
    } catch {
      return false;
    }
    const expr = mkApplyExpr(saved, true);
    for (const other of attached?.values?.() || []) {
      if (!other || other === entry) continue;
      const targetCtxId = resolveTrustedPeerContextId(other);
      if (typeof targetCtxId !== 'number') continue;
      await other.session
        .send('Runtime.evaluate', { expression: expr, contextId: targetCtxId, returnByValue: false, awaitPromise: false })
        .catch(() => {});
    }
    return true;
  }
  return false;
}

module.exports = {
  PARTITIONS_MAX_PAYLOAD_BYTES,
  removePartitionsBinding,
  ensurePartitionsBinding,
  resolveTrustedPeerContextId,
  handlePartitionsBindingCall,
};
