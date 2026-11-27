// Ch17 项目分区持久化 RPC 处理器（零环依赖：上下文守卫与 eval 辅助函数由 rpc-dispatcher.mjs 注入）
import { sanitizeSecretText } from '../../sidecars/daemon/redact.mjs';
import { PARTITIONS_MAX_PAYLOAD_BYTES } from './constants.mjs';
import { serializeJsonForEval } from './fs-atomic.mjs';

const EMPTY_PARTITIONS_STATE = Object.freeze({
  version: 1,
  partitions: [],
  projectToPartition: {},
  expandedProjects: {},
});

export async function handleProjectPartitionsBinding(
  rpc,
  entry,
  payload,
  executionContextId,
  { isTrustedHostContext, resolveTrustedBroadcastContextId, sendFireAndForgetEval } = {}
) {
  if (
    typeof isTrustedHostContext !== 'function' ||
    typeof resolveTrustedBroadcastContextId !== 'function' ||
    typeof sendFireAndForgetEval !== 'function'
  ) {
    return;
  }

  const expectedDocGen = typeof entry?.sidebarDocument === 'number' ? entry.sidebarDocument : null;
  const expectedContext =
    typeof executionContextId === 'number' ? entry?.contextFrames?.get?.(executionContextId) : undefined;
  const checkCtx = () =>
    isTrustedHostContext(entry, executionContextId, expectedDocGen, {
      expectedContext,
      stopped: Boolean(rpc.channelOrchestrator && !rpc.channelOrchestrator.isRunning?.()),
    });
  if (!checkCtx()) return;

  const cdp = rpc.getCdp();
  const cfg = typeof cdp?.readConfig === 'function' ? cdp.readConfig() : null;
  const enabled =
    typeof cdp?.shouldEnableProjectPartitions === 'function'
      ? Boolean(cdp.shouldEnableProjectPartitions(cfg))
      : cfg?.projectPartitions === 'on' || cfg?.projectPartitions === true;
  if (
    !enabled ||
    typeof payload !== 'string' ||
    payload.length > PARTITIONS_MAX_PAYLOAD_BYTES ||
    Buffer.byteLength(payload, 'utf8') > PARTITIONS_MAX_PAYLOAD_BYTES
  ) {
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;

  const action = typeof parsed.action === 'string' ? parsed.action.trim() : '';
  const mkExpr = (d, ex) =>
    `(() => { try { (window.__agPrismProjectPartitions || globalThis.__agPrismProjectPartitions)?.applyPersistedState?.(${serializeJsonForEval(d)}, ${Boolean(ex)}); } catch {} })()`;

  if (action === 'load') {
    const res =
      typeof cdp?.readProjectPartitionsData === 'function'
        ? cdp.readProjectPartitionsData()
        : { exists: false, data: { ...EMPTY_PARTITIONS_STATE } };
    if (checkCtx()) {
      await sendFireAndForgetEval(entry.session, mkExpr(res.data, res.exists), executionContextId, 2000);
    }
    return { ok: true, exists: Boolean(res.exists), data: res.data };
  }

  if (action === 'save') {
    if (typeof cdp?.writeProjectPartitionsData !== 'function') {
      return { ok: false, error: 'partitions_store_unavailable' };
    }
    let saved;
    try {
      saved = cdp.writeProjectPartitionsData(parsed.data);
    } catch (err) {
      return { ok: false, error: sanitizeSecretText(err?.message || err) };
    }
    const syncExpr = mkExpr(saved, true);
    const tasks = [];
    for (const other of rpc.sessionRegistry?.sessions?.values?.() || []) {
      if (!other || other === entry) continue;
      const target = resolveTrustedBroadcastContextId(other);
      if (target.ok) tasks.push(sendFireAndForgetEval(other.session, syncExpr, target.contextId, 2000));
    }
    if (tasks.length > 0) await Promise.allSettled(tasks);
    return { ok: true, data: saved };
  }

  return { ok: false, error: `Unknown projectPartitions action: ${action || 'empty'}` };
}
