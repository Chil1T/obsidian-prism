// Obsidian Prism Telemetry 快照核心指纹与增量 { unchanged: true } 协议辅助（无原型 Mixin，纯函数）
import crypto from 'node:crypto';

function pickWindowSig(win) {
  if (!win || typeof win !== 'object') return null;
  return [
    win.id ?? '',
    win.available ?? null,
    win.disabled === true ? 1 : 0,
    win.expired === true ? 1 : 0,
    win.remaining ?? win.remainingFraction ?? null,
    win.resetAt ?? win.resetTime ?? '',
  ];
}

function pickGroupsSig(groups) {
  if (!Array.isArray(groups) || groups.length === 0) return [];
  return groups.map((g) => {
    if (!g || typeof g !== 'object') return null;
    const ws = g.windows && typeof g.windows === 'object' ? g.windows : null;
    return [
      g.id ?? '',
      g.name ?? '',
      pickWindowSig(ws?.['5h'] || g.fiveHour),
      pickWindowSig(ws?.weekly || g.weekly),
    ];
  });
}

function pickSpeedSig(speed) {
  if (!speed || typeof speed !== 'object') return null;
  const ctx = speed.context && typeof speed.context === 'object' ? speed.context : null;
  const tu = speed.taskUsage && typeof speed.taskUsage === 'object' ? speed.taskUsage : null;
  const cache = speed.cache && typeof speed.cache === 'object' ? speed.cache : null;
  const tokens = speed.tokens && typeof speed.tokens === 'object' ? speed.tokens : null;
  return {
    cid: speed.conversationId ?? '',
    m: speed.model ?? '',
    tps: speed.tps ?? null,
    ltps: speed.latestTps ?? null,
    ttft: speed.ttftSeconds ?? null,
    r: speed.rounds ?? null,
    chr: speed.cacheHitRate ?? null,
    tot: speed.totalTokens ?? null,
    ms: speed.modelSeconds ?? null,
    ts: speed.toolSeconds ?? null,
    sa: speed.savedAt ?? null,
    rfh: speed.restoredFromHistory === true ? 1 : 0,
    cache: cache ? [cache.hitRate ?? null, cache.totalTokens ?? null, cache.readTokens ?? null, cache.writeTokens ?? null] : null,
    tok: tokens ? [tokens.totalTokens ?? null, tokens.inputTokens ?? null, tokens.outputTokens ?? null] : null,
    tu: tu
      ? [
          tu.subagents ?? 0,
          tu.state ?? '',
          tu.complete === true ? 1 : 0,
          tu.own?.totalTokens ?? null,
          tu.delegated?.totalTokens ?? null,
          tu.total?.totalTokens ?? null,
        ]
      : null,
    ctx: ctx
      ? [
          ctx.model ?? '',
          ctx.usedTokens ?? null,
          ctx.maxTokens ?? null,
          ctx.usedFraction ?? null,
          ctx.remainingTokens ?? null,
          ctx.remainingFraction ?? null,
          ctx.compacted === true ? 1 : 0,
          ctx.estimatedAfterCompaction === true ? 1 : 0,
          ctx.sampledAt ?? null,
          ctx.source ?? '',
        ]
      : null,
  };
}

function pickConversationsSig(conversations, includeConversations) {
  if (!includeConversations) return 0;
  if (!Array.isArray(conversations) || conversations.length === 0) return [];
  return conversations.map((c) => [
    c?.id ?? '',
    c?.modifiedAt ?? c?.lastModifiedTime ?? '',
    c?.stepCount ?? null,
    c?.status ?? '',
    c?.title ?? '',
  ]);
}

/**
 * 计算 Telemetry 快照的核心业务指纹（自动忽略瞬态 serverTime，确保内容不变时稳定一致）。
 */
export function computeMetricsSnapshotSig(snap, { includeConversations = true } = {}) {
  if (!snap || typeof snap !== 'object') return '';
  const col = snap.collection && typeof snap.collection === 'object' ? snap.collection : null;
  const core = {
    c: snap.connection ?? '',
    tr: snap.transport ?? '',
    e: snap.error ?? null,
    se: snap.sessionError ?? null,
    pe: snap.persistenceError ?? null,
    qAt: snap.quotaUpdatedAt ?? null,
    col: col ? [col.state ?? '', col.freshness ?? '', col.kind ?? '', col.lastSuccessAt ?? ''] : null,
    g: pickGroupsSig(snap.groups),
    s: pickSpeedSig(snap.speed),
    cv: pickConversationsSig(snap.conversations, includeConversations),
  };
  return crypto.createHash('sha256').update(JSON.stringify(core)).digest('hex').slice(0, 16);
}

/**
 * 统一裁剪与增量回传适配：
 * - 当 includeConversations === false 时裁剪 conversations 数组；
 * - 当调用方显式携带 lastSig / ifModifiedSince（且非 force/freshContext/quotaRefresh/includeUsage）
 *   且核心指纹与当前快照完全一致时，返回轻量 { unchanged: true, sig }，替代 ~6KB JSON.parse 全量下发。
 */
export function buildMetricsBindingReply(result, input = null) {
  const safeInput = input && typeof input === 'object' ? input : {};
  const includeConversations = safeInput.includeConversations !== false;
  let out = result;
  if (
    !includeConversations &&
    out &&
    typeof out === 'object' &&
    Array.isArray(out.conversations) &&
    out.conversations.length > 0
  ) {
    out = { ...out, conversations: [] };
  }
  if (!out || typeof out !== 'object' || safeInput.includeUsage === true) {
    return out;
  }
  const hasDeltaReq =
    typeof safeInput.lastSig === 'string' || typeof safeInput.ifModifiedSince === 'string';
  if (!hasDeltaReq) {
    return out;
  }
  const reqSig = (
    typeof safeInput.lastSig === 'string'
      ? safeInput.lastSig
      : typeof safeInput.ifModifiedSince === 'string'
        ? safeInput.ifModifiedSince
        : ''
  ).trim();
  const sig = computeMetricsSnapshotSig(out, { includeConversations });
  if (!sig) return out;
  const bypassDelta = Boolean(safeInput.force || safeInput.freshContext || safeInput.quotaRefresh);
  if (reqSig && !bypassDelta && reqSig === sig) {
    return {
      unchanged: true,
      sig,
      ...(typeof out.transport === 'string' && out.transport ? { transport: out.transport } : {}),
    };
  }
  return { ...out, sig };
}
