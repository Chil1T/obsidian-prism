(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.__agCsUsageCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  const HOME_HEAT_WEEKS = 26;
  const HOME_HEAT_RAMP = [8, 28, 52, 76, 100];
  const HOME_HEAT_STEPS = HOME_HEAT_RAMP.length;
  const HOME_CHART_DAYS = 30;
  const HOME_MODEL_ROWS = 6;
  const HOME_MODEL_COLOUR_COUNT = 10;

  function numOr(v) {
    return typeof v === 'bigint' ? Number(v) : v;
  }

  function toNum(v) {
    const n = typeof v === 'number' || typeof v === 'bigint' || typeof v === 'string' ? Number(v) : 0;
    return Number.isFinite(n) ? n : 0;
  }

  const L8 = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de'];
  function resolveLang(langOrZh) {
    if (langOrZh === true) return 'zh-CN';
    if (!langOrZh) return 'en';
    const lo = String(langOrZh).trim().toLowerCase();
    if (!lo) return 'en';
    if (/^yue(?:$|[-_])/.test(lo)) return 'zh-CN';
    if (/^zh(?:$|[-_])/.test(lo)) return /tw|hk|mo|hant/.test(lo) ? 'zh-TW' : 'zh-CN';
    const m = lo.match(/^(en|ja|ko|es|fr|de)(?:$|[-_])/);
    return m ? m[1] : 'en';
  }

  function pick8(arr, langOrZh) {
    const i = L8.indexOf(resolveLang(langOrZh));
    return arr[i >= 0 ? i : 2] ?? arr[2];
  }

  const mkLbls = (a) => Object.fromEntries(L8.map((k, i) => [k, a[i]]));
  const HOME_RANGES = [
    ['all', 0, '全部', 'All', ['全部', '全部', 'All', '全期間', '전체', 'Todo', 'Tout', 'Alle']],
    ['30d', 30, '30 天', '30d', ['30 天', '30 天', '30d', '30日間', '30일', '30d', '30j', '30T']],
    ['7d', 7, '7 天', '7d', ['7 天', '7 天', '7d', '7日間', '7일', '7d', '7j', '7T']],
  ].map(([id, days, labelZh, labelEn, a]) => ({ id, days, labelZh, labelEn, labels: mkLbls(a) }));

  const wrapTitle = (s, l, r) => (s[0] === l ? s : l + s + r);
  const HOME_BOOKS = `tao|7607|道德经|道德經|老子（道徳経）|Tao Te Ching
yellow|7778|黄色壁纸|黃色壁紙|黄色い壁紙|The Yellow Wallpaper
meta|27557|变形记|變形記|変身|Metamorphosis
jekyll|34713|化身博士||ジーキル博士とハイド氏|The Strange Case of Dr Jekyll and Mr Hyde
alice|37248|爱丽丝漫游奇境|愛麗絲夢遊仙境|不思議の国のアリス|Alice's Adventures in Wonderland
animal|39000|动物农场|動物農莊|動物農場|Animal Farm
carol|40306|圣诞颂歌|小氣財神|クリスマス・キャロル|A Christmas Carol
wild|42383|野性的呼唤|野性的呼喚|野生の呼び声|The Call of the Wild
time|42817|时间机器|時間機器|タイム・マシン|The Time Machine
oz|51004|绿野仙踪|綠野仙蹤|オズの魔法使い|The Wonderful Wizard of Oz
darkness|52163|黑暗之心||闇の奥|Heart of Darkness
faust|53930|浮士德||ファウスト|Faust
screw|57484|螺丝在拧紧|碧廬冤孽|ねじの回転|The Turn of the Screw
aesop|60707|伊索寓言||イソップ寓話|Aesop's Fables
peter|63821|彼得·潘|小飛俠彼得潘|ピーター・パン|Peter Pan
gatsby|65763|了不起的盖茨比|大亨小傳|グレート・ギャツビー|The Great Gatsby
prince|66670|君主论|君王論|君主論|The Prince
invisible|68163|隐形人|隱形人|透明人間|The Invisible Man
andersen|73931|安徒生童话|安徒生童話|アンデルセン童話集|Andersen's Fairy Tales
worlds|80168|世界大战|世界大戰|宇宙戦争|The War of the Worlds
beyond|89836|善恶的彼岸|善惡的彼岸|善悪の彼岸|Beyond Good and Evil
whitefang|96418|白牙||白い牙|White Fang
meditations|96973|沉思录|沉思錄|自省録|Meditations
frankenstein|97886|弗兰肯斯坦|科學怪人|フランケンシュタイン|Frankenstein
stone|100000|哈利·波特与魔法石|哈利波特：神秘的魔法石|ハリー・ポッターと賢者の石|Harry Potter and the Philosopher's Stone
dorian|106339|道林·格雷的画像|格雷的畫像|ドリアン・グレイの肖像|The Picture of Dorian Gray
tolive|115000|活着|活著|生きる|To Live
hobbit|123000|霍比特人|哈比人歷險記|ホビットの冒険|The Hobbit
grimm|132467|格林童话|格林童話|グリム童話集|Grimms' Fairy Tales
1984|136278|一九八四||1984年|Nineteen Eighty-Four
sherlock|138725|福尔摩斯冒险史|福爾摩斯冒險史|シャーロック・ホームズの冒険|The Adventures of Sherlock Holmes
gulliver|138958|格列佛游记|格列佛遊記|ガリヴァー旅行記|Gulliver's Travels
walden|152659|瓦尔登湖|湖濱散記|ウォールデン 森の生活|Walden
crusoe|153596|鲁滨逊漂流记|魯賓遜漂流記|ロビンソン・クルーソー|Robinson Crusoe
huck|154263|哈克贝利·费恩历险记|頑童歷險記|ハックルベリー・フィンの冒険|Adventures of Huckleberry Finn
divine|157765|神曲||神曲|The Divine Comedy
bovary|159575|包法利夫人||ボヴァリー夫人|Madame Bovary
zarathustra|161488|查拉图斯特拉如是说|查拉圖斯特拉如是說|ツァラトゥストラはこう語った|Thus Spoke Zarathustra
pride|171701|傲慢与偏见|傲慢與偏見|高慢と偏見|Pride and Prejudice
odyssey|173150|奥德赛|奧德賽|オデュッセイア|The Odyssey
twocities|187333|双城记|雙城記|二都物語|A Tale of Two Cities
threebody|202000|三体|三體|三体|The Three-Body Problem
dracula|213648|德古拉||ドラキュラ|Dracula
expectations|252176|远大前程|孤星血淚|大いなる遺産|Great Expectations
janeeyre|256179|简·爱|簡·愛|ジェイン・エア|Jane Eyre
republic|279539|理想国|理想國|国家|The Republic
crime|285009|罪与罚|罪與罰|罪と罰|Crime and Punishment
leviathan|304696|利维坦|利維坦|リヴァイアサン|Leviathan
moby|306522|白鲸|白鯨記|白鯨|Moby-Dick
darkforest|307000|三体Ⅱ·黑暗森林|三體Ⅱ·黑暗森林|三体II 黒暗森林|The Dark Forest
deathsend|336000|三体Ⅲ·死神永生|三體Ⅲ·死神永生|三体III 死神永生|Death's End
anna|481659|安娜·卡列尼娜||アンナ・カレーニナ|Anna Karenina
karamazov|487590|卡拉马佐夫兄弟|卡拉馬佐夫兄弟|カラマーゾフの兄弟|The Brothers Karamazov
quixote|574243|堂吉诃德|唐吉訶德|ドン・キホーテ|Don Quixote
lotr|625000|魔戒||指輪物語|The Lord of the Rings
kingdoms|638009|三国演义|三國演義|三国志演義|Romance of the Three Kingdoms
montecristo|651128|基督山伯爵|基督山恩仇記|モンテ・クリスト伯|The Count of Monte Cristo
warpeace|769001|战争与和平|戰爭與和平|戦争と平和|War and Peace
journeywest|783200|西游记|西遊記|西遊記|Journey to the West
miserables|801791|悲惨世界|悲慘世界|レ・ミゼラブル|Les Misérables
redchamber|903956|红楼梦|紅樓夢|紅楼夢|Dream of the Red Chamber
watermargin|958242|水浒传|水滸傳|水滸伝|Water Margin
ordinary|998000|平凡的世界||平凡な世界|Ordinary World
harrypotter|1409000|《哈利·波特》全集|《哈利波特》全集|『ハリー・ポッター』全巻|the whole Harry Potter series
losttime|1647000|追忆似水年华|追憶似水年華|失われた時を求めて|In Search of Lost Time`.split('\n').map((row) => {
    const [key, tk, z0, t0, j0, en] = row.split('|');
    const zh = wrapTitle(z0, '《', '》');
    return { key, tokens: +tk, zh, zhTW: t0 ? wrapTitle(t0, '《', '》') : zh, ja: wrapTitle(j0, '『', '』'), en };
  });

  function homeBookTitle(book, langOrZh) {
    if (!book) return '';
    const l = resolveLang(langOrZh);
    if (l === 'zh-CN') return book.zh;
    if (l === 'zh-TW') return book.zhTW || book.zh;
    if (l === 'ja') return book.ja || book.en;
    return book.en;
  }

  function homeRangeLabel(rangeOrId, langOrZh) {
    const r = typeof rangeOrId === 'string' ? (HOME_RANGES.find((x) => x.id === rangeOrId) || HOME_RANGES[0]) : rangeOrId;
    if (!r) return '';
    const l = resolveLang(langOrZh);
    return (r.labels && (r.labels[l] ?? r.labels.en)) || r.labelEn || '';
  }

  function pad2(v) {
    return v < 10 ? '0' + v : String(v);
  }

  function homeDayKey(date) {
    const d = date instanceof Date ? date : new Date(numOr(date));
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function homeRangeStart(windowDays, nowDate) {
    if (!windowDays) return null;
    const start = nowDate ? new Date(nowDate.getTime()) : new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (windowDays - 1));
    return homeDayKey(start);
  }

  function formatHomeCount(count) {
    const value = Math.round(toNum(count));
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function formatCompactTokens(count) {
    const value = toNum(count);
    const units = [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']];
    for (let u = 0; u < units.length; u++) {
      const scaled = Math.round((value / units[u][0]) * 10) / 10;
      if (scaled >= 1) return String(scaled) + units[u][1];
    }
    return String(Math.round(value));
  }

  function formatHomeHour(hour, langOrZh) {
    const h = ((Math.floor(toNum(hour)) % 24) + 24) % 24;
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const l = resolveLang(langOrZh);
    if (l === 'zh-CN') return (h < 12 ? '上午 ' : '下午 ') + h12 + ' 点';
    if (l === 'zh-TW') return (h < 12 ? '上午 ' : '下午 ') + h12 + ' 點';
    if (l === 'ja') return (h < 12 ? '午前 ' : '午後 ') + h12 + ' 時';
    if (l === 'ko') return (h < 12 ? '오전 ' : '오후 ') + h12 + '시';
    if (l === 'fr') return h + 'h';
    if (l === 'de') return h + ' Uhr';
    if (l === 'es') return h + ':00';
    return h12 + (h < 12 ? ' AM' : ' PM');
  }

  function homeShortDateFormat(langOrZh) {
    return new Intl.DateTimeFormat(pick8(['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'es-ES', 'fr-FR', 'de-DE'], langOrZh), { month: 'short', day: 'numeric' });
  }

  function homeShortDate(format, day) {
    const parts = String(day || '').split('-');
    if (parts.length !== 3) return String(day || '');
    return format.format(new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  }

  function tsToMs(ts) {
    if (!ts) return 0;
    if (typeof ts === 'number') return Number.isFinite(ts) ? ts : 0;
    if (typeof ts === 'string' || typeof ts === 'bigint') {
      const parsed = typeof ts === 'string' ? Date.parse(ts) : NaN;
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
      const num = toNum(ts);
      return num > 0 ? (num > 1e11 ? num : num * 1000) : 0;
    }
    const sec = toNum(ts.seconds);
    return sec > 0 ? sec * 1000 + Math.floor(toNum(ts.nanos) / 1e6) : 0;
  }

  function cleanModelName(val) {
    const direct = val?.modelDisplayName || val?.responseModel || val?.modelName;
    if (direct && String(direct).trim()) return String(direct).trim();
    const m = val?.model;
    if (typeof m === 'string' && m.trim()) {
      return /^\d+$/.test(m.trim()) ? 'Model #' + m.trim() : m.trim();
    }
    if (m) return 'Model #' + m;
    return 'unknown';
  }

  function eqId(a, b) { return !!(a && b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase()); }

  function isSubagentSummary(summary, selfId) {
    if (!summary || typeof summary !== 'object') return false;
    const s = String(selfId || summary.cascadeId || summary.id || '').trim();
    const m = summary.trajectoryMetadata || {};
    const p = String(m.parentConversationId || summary.parentConversationId || summary.parentId || '').trim();
    const r = String(m.rootConversationId || summary.rootConversationId || summary.rootId || '').trim();
    if ((p && !eqId(p, s)) || (s && r && !eqId(r, s)) || toNum(m.nestingDepth) > 0) return true;
    return summary.subagent === true && !eqId(p, s) && !eqId(r, s);
  }

  function normalizeWorkspaceLabel(rawUriOrPath) {
    const s = String(rawUriOrPath || '').trim();
    if (!s) return '';
    try {
      const decoded = decodeURIComponent(s.replace(/^file:\/\//i, '')).replace(/[\\/]+$/, '');
      const segs = decoded.split(/[\\/]/).filter(Boolean);
      return segs.length ? segs[segs.length - 1] : '';
    } catch {
      const segs = s.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean);
      return segs.length ? segs[segs.length - 1] : '';
    }
  }

  function extractWorkspaceId(summaryObj, trajObj) {
    if (summaryObj && typeof summaryObj.workspace === 'string' && summaryObj.workspace.trim()) {
      return normalizeWorkspaceLabel(summaryObj.workspace);
    }
    const wsList =
      summaryObj?.workspaces ||
      summaryObj?.trajectoryMetadata?.workspaces ||
      trajObj?.metadata?.workspaces ||
      [];
    const first = Array.isArray(wsList) && wsList.length ? wsList[0] : null;
    const candidate =
      first?.workspaceFolderAbsoluteUri ||
      first?.gitRootAbsoluteUri ||
      first?.uri ||
      first?.path ||
      summaryObj?.workspaceUri ||
      summaryObj?.workspacePath ||
      summaryObj?.trajectoryMetadata?.workspaceUri ||
      '';
    return normalizeWorkspaceLabel(candidate);
  }

  function extractParentConversationId(summaryObj, trajObj, selfId) {
    const s = String(selfId || summaryObj?.cascadeId || summaryObj?.id || trajObj?.cascadeId || '').trim();
    const tm = summaryObj?.trajectoryMetadata;
    const p = String(tm?.parentConversationId || summaryObj?.parentConversationId || summaryObj?.parentId || trajObj?.metadata?.parentConversationId || '').trim();
    if (p) return eqId(p, s) ? '' : p;
    const r = String(tm?.rootConversationId || summaryObj?.rootConversationId || summaryObj?.rootId || '').trim();
    return r && s && !eqId(r, s) ? r : '';
  }

  // Extract a compact, JSON-serializable per-conversation usage record for caching.
  function analyzeTrajectoryForUsage(trajObj, summaryObj, cascadeId) {
    const t = trajObj?.response?.trajectory || trajObj?.trajectory || trajObj || {};
    const steps = Array.isArray(t.steps) ? t.steps : [];
    const gmList = Array.isArray(t.generatorMetadata) ? t.generatorMetadata : [];
    const stepTime = new Map();
    for (let i = 0; i < steps.length; i++) {
      const ms = tsToMs(steps[i]?.metadata?.createdAt || steps[i]?.createdAt);
      if (ms > 0) stepTime.set(i, ms);
    }
    const createdMs = tsToMs(summaryObj?.createdTime) || tsToMs(t?.metadata?.createdAt) || 0;
    const lastModMs = tsToMs(summaryObj?.lastModifiedTime) || 0;
    const fallbackMs = lastModMs || createdMs || 0;
    const totalStepSpan = Math.max(1, toNum(summaryObj?.stepCount ?? trajObj?.numTotalSteps ?? steps.length ?? 1));

    const days = {}; // YYYY-MM-DD -> { calls, input, output, cacheRead, cacheWrite, total, hours: number[24], models: { [id]: { input, output, cacheRead, cacheWrite, total, calls } } }
    let calls = 0;

    for (let i = 0; i < gmList.length; i++) {
      const val = gmList[i]?.metadata?.value || gmList[i]?.chatModel;
      if (!val) continue;
      const u = val.usage || val.retryInfos?.[val.retryInfos.length - 1]?.usage || gmList[i]?.usage;
      if (!u) continue;
      const input = toNum(u.inputTokens);
      const cacheRead = toNum(u.cacheReadTokens);
      const cacheWrite = toNum(u.cacheWriteTokens);
      const output = toNum(u.outputTokens);
      const total = input + cacheRead + cacheWrite + output;
      if (total <= 0 && input === 0 && output === 0) continue;

      calls += 1;
      const sIndices = Array.isArray(gmList[i].stepIndices) ? gmList[i].stepIndices : [];
      let ts = 0;
      for (let k = 0; k < sIndices.length; k++) {
        const hit = stepTime.get(numOr(sIndices[k]));
        if (hit) {
          ts = hit;
          break;
        }
      }
      if (!ts) {
        const chatCreatedMs = tsToMs(val?.chatStartMetadata?.createdAt);
        if (chatCreatedMs > 0) {
          ts = chatCreatedMs;
        } else if (steps.length === 0 && createdMs > 0 && lastModMs > createdMs && sIndices.length > 0) {
          const ratio = Math.min(1, Math.max(0, toNum(sIndices[0]) / totalStepSpan));
          ts = Math.round(createdMs + ratio * (lastModMs - createdMs));
        } else {
          ts = fallbackMs;
        }
      }
      if (!ts) continue;

      const d = new Date(ts);
      const dayKey = homeDayKey(d);
      const hour = d.getHours();
      const modelId = cleanModelName(val);

      let day = days[dayKey];
      if (!day) {
        day = {
          calls: 0,
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
          hours: new Array(24).fill(0),
          models: {},
        };
        days[dayKey] = day;
      }
      day.calls += 1;
      day.input += input;
      day.output += output;
      day.cacheRead += cacheRead;
      day.cacheWrite += cacheWrite;
      day.total += total;
      day.hours[hour] = (day.hours[hour] || 0) + 1;

      let mod = day.models[modelId];
      if (!mod) {
        mod = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, calls: 0 };
        day.models[modelId] = mod;
      }
      mod.input += input;
      mod.output += output;
      mod.cacheRead += cacheRead;
      mod.cacheWrite += cacheWrite;
      mod.total += total;
      mod.calls += 1;
    }

    const lastModifiedSec =
      toNum(summaryObj?.lastModifiedSec) ||
      toNum(summaryObj?.lastModifiedTime?.seconds) ||
      (lastModMs > 0 ? Math.floor(lastModMs / 1000) : 0);
    const workspace = extractWorkspaceId(summaryObj, t);
    const parentId = extractParentConversationId(summaryObj, t, cascadeId);

    return {
      cascadeId: String(cascadeId || t.cascadeId || ''),
      stepCount: Math.max(toNum(summaryObj?.stepCount), toNum(trajObj?.numTotalSteps), steps.length),
      lastModifiedSec,
      gmCount: toNum(trajObj?.numTotalGeneratorMetadata ?? gmList.length),
      subagent: isSubagentSummary(summaryObj, cascadeId),
      workspace,
      parentId,
      calls,
      days,
    };
  }

  function mergeUsageRecordDelta(baseRec, deltaRec, nextMeta = {}) {
    if (!baseRec || !baseRec.days) return deltaRec;
    const days = {};
    for (const [dk, d] of Object.entries(baseRec.days)) {
      if (!d) continue;
      const models = {};
      for (const [mk, mv] of Object.entries(d.models || {})) {
        if (mv) models[mk] = { input: toNum(mv.input), output: toNum(mv.output), cacheRead: toNum(mv.cacheRead), cacheWrite: toNum(mv.cacheWrite), total: toNum(mv.total), calls: toNum(mv.calls) };
      }
      const hours = new Array(24).fill(0);
      if (Array.isArray(d.hours)) for (let h = 0; h < 24; h++) hours[h] = toNum(d.hours[h]);
      days[dk] = {
        calls: toNum(d.calls),
        input: toNum(d.input),
        output: toNum(d.output),
        cacheRead: toNum(d.cacheRead),
        cacheWrite: toNum(d.cacheWrite),
        total: toNum(d.total),
        hours,
        models,
      };
    }
    if (deltaRec && deltaRec.days) {
      for (const [dk, dd] of Object.entries(deltaRec.days)) {
        if (!dd) continue;
        let dst = days[dk];
        if (!dst) {
          dst = {
            calls: 0,
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
            hours: new Array(24).fill(0),
            models: {},
          };
          days[dk] = dst;
        }
        dst.calls += toNum(dd.calls);
        dst.input += toNum(dd.input);
        dst.output += toNum(dd.output);
        dst.cacheRead += toNum(dd.cacheRead);
        dst.cacheWrite += toNum(dd.cacheWrite);
        dst.total += toNum(dd.total);
        if (Array.isArray(dd.hours)) {
          for (let h = 0; h < 24; h++) dst.hours[h] = (dst.hours[h] || 0) + toNum(dd.hours[h]);
        }
        for (const [mk, mv] of Object.entries(dd.models || {})) {
          if (!mv) continue;
          let dm = dst.models[mk];
          if (!dm) {
            dm = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, calls: 0 };
            dst.models[mk] = dm;
          }
          dm.input += toNum(mv.input);
          dm.output += toNum(mv.output);
          dm.cacheRead += toNum(mv.cacheRead);
          dm.cacheWrite += toNum(mv.cacheWrite);
          dm.total += toNum(mv.total);
          dm.calls += toNum(mv.calls);
        }
      }
    }
    const cid = String(nextMeta.cascadeId ?? deltaRec?.cascadeId ?? baseRec.cascadeId ?? '');
    const p = String(nextMeta.parentId ?? deltaRec?.parentId ?? baseRec.parentId ?? '').trim();
    const r = String(nextMeta.rootId ?? deltaRec?.rootId ?? baseRec.rootId ?? '').trim();
    const sp = eqId(p, cid) || (!p && eqId(r, cid));
    const bp = eqId(baseRec.parentId, cid) || (!baseRec.parentId && eqId(baseRec.rootId || baseRec.rootConversationId, cid));
    return {
      cascadeId: cid,
      stepCount: toNum(nextMeta.stepCount ?? deltaRec?.stepCount ?? baseRec.stepCount ?? 0),
      lastModifiedSec: toNum(nextMeta.lastModifiedSec ?? deltaRec?.lastModifiedSec ?? baseRec.lastModifiedSec ?? 0),
      gmCount: toNum(nextMeta.gmCount ?? deltaRec?.gmCount ?? baseRec.gmCount ?? 0),
      subagent: sp ? false : Boolean(nextMeta.subagent ?? deltaRec?.subagent ?? (bp ? false : baseRec.subagent)),
      workspace: String(nextMeta.workspace ?? deltaRec?.workspace ?? baseRec.workspace ?? ''),
      parentId: sp ? '' : p,
      calls: toNum(baseRec.calls) + toNum(deltaRec?.calls),
      days,
    };
  }

  function homeHeatGrid(dayTotalsMap, nowDate) {
    const today = nowDate ? new Date(nowDate.getTime()) : new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - (HOME_HEAT_WEEKS * 7 - 1));
    start.setDate(start.getDate() - start.getDay());
    const cells = [];
    let peak = 0;
    for (const cursor = new Date(start); cursor <= today; cursor.setDate(cursor.getDate() + 1)) {
      const key = homeDayKey(cursor);
      const tokens = toNum(dayTotalsMap[key]);
      if (tokens > peak) peak = tokens;
      cells.push({ date: key, tokens, level: 0 });
    }
    for (let c = 0; c < cells.length; c++) {
      if (cells[c].tokens <= 0 || peak <= 0) continue;
      cells[c].level = Math.max(1, Math.min(HOME_HEAT_STEPS, Math.ceil((cells[c].tokens / peak) * HOME_HEAT_STEPS)));
    }
    return { cells, peak };
  }

  function aggregateUsageRollup(records, rangeId, bookPick, zh, nowDate, options = {}) {
    const list = Array.isArray(records) ? records : [];
    const rangeObj = HOME_RANGES.find((r) => r.id === rangeId) || HOME_RANGES[0];
    const start = homeRangeStart(rangeObj.days, nowDate);
    const inRange = (dateStr) => start === null || dateStr >= start;
    const workspaceFilter =
      options && typeof options.workspace === 'string' && options.workspace && options.workspace !== 'all'
        ? options.workspace
        : '';

    const byId = new Map();
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r && r.cascadeId) byId.set(r.cascadeId, r);
    }
    const resolveRecWorkspace = (rec) => {
      if (!rec) return '';
      if (rec.workspace) return String(rec.workspace);
      let cur = rec;
      for (let hop = 0; hop < 4 && cur && cur.parentId && !eqId(cur.parentId, cur.cascadeId); hop++) {
        const p = byId.get(cur.parentId);
        if (!p) break;
        if (p.workspace) return String(p.workspace);
        cur = p;
      }
      return '';
    };

    let totalTokens = 0;
    let mainTokens = 0;
    let subagentTokens = 0;
    let totalCalls = 0;
    let totalInput = 0;
    let totalCacheRead = 0;
    const sessionSet = new Set();
    const subagentSessionSet = new Set();
    const activeDaySet = new Set();
    const hourCounts = new Array(24).fill(0);
    const modelTotals = {}; // modelId -> { id, input, output, cacheRead, cacheWrite, tokens, subagentTokens, calls, sessionsSet: Set }
    const allDayTotals = {}; // full calendar day -> tokens (heat grid shows 26 weeks)
    const allDayModels = {}; // full calendar day -> { modelId: tokens } (chart shows 30d/7d)
    const workspaceMap = {}; // wsId -> { id, tokens, sessionsSet: Set }

    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      if (!rec || !rec.days) continue;
      const isSub = !!(rec.subagent && !eqId(rec.parentId, rec.cascadeId) && (rec.parentId || !eqId(rec.rootId || rec.rootConversationId, rec.cascadeId)));
      const wsId = resolveRecWorkspace(rec);
      const dayKeys = Object.keys(rec.days);

      // Accumulate workspace index across all records in range regardless of active workspaceFilter
      if (wsId) {
        let wsEntry = workspaceMap[wsId];
        if (!wsEntry) {
          wsEntry = { id: wsId, tokens: 0, sessionsSet: new Set() };
          workspaceMap[wsId] = wsEntry;
        }
        for (let d = 0; d < dayKeys.length; d++) {
          const dk = dayKeys[d];
          if (!inRange(dk)) continue;
          const day = rec.days[dk];
          if (!day) continue;
          const dt = toNum(day.total);
          wsEntry.tokens += dt;
          if (!isSub && (dt > 0 || toNum(day.calls) > 0)) {
            wsEntry.sessionsSet.add(rec.cascadeId || String(i));
          }
        }
      }

      if (workspaceFilter && wsId !== workspaceFilter) continue;

      let countedSessionInRange = false;
      for (let d = 0; d < dayKeys.length; d++) {
        const dk = dayKeys[d];
        const day = rec.days[dk];
        if (!day) continue;
        const dTotal = toNum(day.total);
        allDayTotals[dk] = (allDayTotals[dk] || 0) + dTotal;

        if (day.models) {
          if (!allDayModels[dk]) allDayModels[dk] = {};
          for (const [mId, mData] of Object.entries(day.models)) {
            allDayModels[dk][mId] = (allDayModels[dk][mId] || 0) + toNum(mData.total);
          }
        }

        if (!inRange(dk)) continue;
        const dCalls = toNum(day.calls);
        if (dTotal > 0 || dCalls > 0) {
          activeDaySet.add(dk);
          if (isSub) {
            subagentSessionSet.add(rec.cascadeId || String(i));
          } else if (!countedSessionInRange) {
            sessionSet.add(rec.cascadeId || String(i));
            countedSessionInRange = true;
          }
        }
        totalTokens += dTotal;
        if (isSub) subagentTokens += dTotal;
        else mainTokens += dTotal;
        totalCalls += dCalls;
        const dCacheRead = toNum(day.cacheRead);
        const dInp = toNum(day.input) + dCacheRead + toNum(day.cacheWrite);
        totalInput += dInp;
        totalCacheRead += dCacheRead;

        if (Array.isArray(day.hours)) {
          for (let h = 0; h < 24; h++) {
            hourCounts[h] += toNum(day.hours[h]);
          }
        }
        if (day.models) {
          for (const [mId, mData] of Object.entries(day.models)) {
            let entry = modelTotals[mId];
            if (!entry) {
              entry = {
                id: mId,
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                tokens: 0,
                subagentTokens: 0,
                calls: 0,
                sessionsSet: new Set(),
              };
              modelTotals[mId] = entry;
            }
            const mTok = toNum(mData.total);
            entry.input += toNum(mData.input);
            entry.output += toNum(mData.output);
            entry.cacheRead += toNum(mData.cacheRead);
            entry.cacheWrite += toNum(mData.cacheWrite);
            entry.tokens += mTok;
            if (isSub) entry.subagentTokens += mTok;
            entry.calls += toNum(mData.calls);
            if (!isSub) entry.sessionsSet.add(rec.cascadeId || String(i));
          }
        }
      }
    }

    let bestHour = 0;
    let hourSum = 0;
    for (let h = 0; h < 24; h++) {
      hourSum += hourCounts[h];
      if (hourCounts[h] > hourCounts[bestHour]) bestHour = h;
    }
    const peakHour = hourSum > 0 ? formatHomeHour(bestHour, zh) : null;

    const models = Object.values(modelTotals)
      .map((m) => {
        const mInp = m.input + m.cacheRead + m.cacheWrite;
        return {
          id: m.id,
          input: m.input,
          output: m.output,
          cacheRead: m.cacheRead,
          cacheWrite: m.cacheWrite,
          tokens: m.tokens,
          subagentTokens: m.subagentTokens,
          cacheHitRate: mInp > 0 ? m.cacheRead / mInp : null,
          calls: m.calls,
          sessions: m.sessionsSet.size,
        };
      })
      .sort((a, b) => b.tokens - a.tokens || b.calls - a.calls || a.id.localeCompare(b.id));

    const workspaces = Object.values(workspaceMap)
      .map((w) => ({ id: w.id, tokens: w.tokens, sessions: w.sessionsSet.size }))
      .filter((w) => w.tokens > 0 || w.sessions > 0)
      .sort((a, b) => b.tokens - a.tokens || a.id.localeCompare(b.id));

    const favModel = models.length > 0 ? models[0].id : null;

    // Book comparison
    let funBook = null;
    if (totalTokens > 0) {
      const pick = typeof bookPick === 'number' && Number.isFinite(bookPick) ? Math.max(0, Math.min(0.999999, bookPick)) : 0.07;
      let idx = Math.min(HOME_BOOKS.length - 1, Math.floor(pick * HOME_BOOKS.length));
      while (idx >= 0 && totalTokens < HOME_BOOKS[idx].tokens) idx -= 1;
      if (idx >= 0) {
        const book = HOME_BOOKS[idx];
        const count = Math.max(1, Math.round(totalTokens / book.tokens));
        const l = resolveLang(zh);
        const title = homeBookTitle(book, l);
        const cntStr = formatHomeCount(count);
        funBook = pick8([
          `你的 Token 用量相当于 ${cntStr} 本${title}。`,
          `您的 Token 用量相當於 ${cntStr} 本${title}。`,
          `You've used ~${cntStr}× the tokens in ${title}.`,
          `消費トークン数は${title} ${cntStr} 冊分に相当します。`,
          `사용한 토큰은 ${title} 약 ${cntStr}권 분량입니다.`,
          `Has usado ~${cntStr}× los tokens de ${title}.`,
          `Vous avez utilisé ~${cntStr}× les tokens de ${title}.`,
          `Verbraucht: ~${cntStr}× die Token von ${title}.`,
        ], l);
      }
    }

    // Chart columns (last 30d or 7d)
    const chartSpan = rangeObj.days > 0 && rangeObj.days < HOME_CHART_DAYS ? rangeObj.days : HOME_CHART_DAYS;
    const chartStart = homeRangeStart(chartSpan, nowDate);
    const modelDays = Object.keys(allDayModels)
      .filter((dk) => dk >= chartStart)
      .sort()
      .map((dk) => ({ date: dk, models: allDayModels[dk] }));

    return {
      sessions: sessionSet.size,
      subagentSessions: subagentSessionSet.size,
      calls: totalCalls,
      tokens: totalTokens,
      mainTokens,
      subagentTokens,
      totalInput,
      cacheReadTokens: totalCacheRead,
      cacheHitRate: totalInput > 0 ? totalCacheRead / totalInput : null,
      activeDays: activeDaySet.size,
      peakHour,
      model: favModel,
      grid: homeHeatGrid(allDayTotals, nowDate),
      funBook,
      models,
      modelDays,
      workspaces,
    };
  }

  // ── v0.9.1 Quota Pools, Argon Weekly Allowance & Linear Depletion Forecast ──
  function quotaGroupKind(group) {
    if (!group || typeof group !== 'object') return 'other';
    const w5 = group.windows?.['5h']?.id || group.fiveHour?.id || '';
    const ww = group.windows?.weekly?.id || group.weekly?.id || '';
    const hay = `${group.id || ''} ${group.name || ''} ${group.description || ''} ${w5} ${ww}`.toLowerCase();
    if (/argon|wtu/.test(hay)) return 'gemini-argon';
    if (/claude|anthropic|gpt|openai/.test(hay)) return 'claude';
    if (/gemini|google/.test(hay)) return 'gemini';
    return 'other';
  }

  function quotaGroupLabel(group, langOrZh) {
    const kind = quotaGroupKind(group);
    if (kind === 'gemini-argon') return 'Gemini (Argon)';
    if (kind === 'claude') return 'Claude / GPT';
    if (kind === 'gemini') return 'Gemini';
    const raw = String(group?.name || group?.id || '').trim();
    if (raw) return raw;
    return pick8(['模型配额', '模型配額', 'Quota Pool', 'クォータ', '할당량 풀', 'Cuota', 'Quota', 'Kontingent'], langOrZh);
  }

  function quotaRemaining(bucket) {
    if (!bucket || typeof bucket !== 'object' || bucket.available === false || bucket.disabled === true) return null;
    if (bucket.expired === true) return 1;
    const r = numOr(bucket.remaining ?? bucket.remainingFraction);
    if (typeof r === 'number' && Number.isFinite(r)) return Math.max(0, Math.min(1, r));
    if (typeof r === 'string' && r.trim() !== '' && Number.isFinite(Number(r))) {
      return Math.max(0, Math.min(1, Number(r)));
    }
    return null;
  }

  function quotaWindows(group) {
    if (!group || typeof group !== 'object') return [];
    const w5 = group.windows?.['5h'] || group.fiveHour || null;
    const ww = group.windows?.weekly || group.weekly || null;
    const out = [];
    if (w5 && quotaRemaining(w5) !== null) out.push(['5h', w5]);
    if (ww && quotaRemaining(ww) !== null) out.push(['weekly', ww]);
    return out;
  }

  function chooseQuotaGroup(groups, models, selectedId) {
    const list = Array.isArray(groups) ? groups.filter((g) => g && typeof g === 'object') : [];
    if (!list.length) return null;
    if (selectedId) {
      const hit = list.find((g) => g.id === selectedId || g.name === selectedId);
      if (hit) return hit;
    }
    const modelStr = (Array.isArray(models) ? models.join(' ') : String(models || '')).toLowerCase();
    if (/argon/.test(modelStr)) {
      const argon = list.find((g) => quotaGroupKind(g) === 'gemini-argon');
      if (argon) return argon;
      const gem = list.find((g) => quotaGroupKind(g) === 'gemini');
      if (gem) return gem;
    } else if (/claude|anthropic|sonnet|opus|haiku|gpt|openai|o1|o3|o4/.test(modelStr)) {
      const cld = list.find((g) => quotaGroupKind(g) === 'claude');
      if (cld) return cld;
    } else if (/gemini|carbon|hydrogen|pro|flash/.test(modelStr)) {
      const gem = list.find((g) => quotaGroupKind(g) === 'gemini');
      if (gem) return gem;
      const argon = list.find((g) => quotaGroupKind(g) === 'gemini-argon');
      if (argon) return argon;
    }
    return list.find((g) => quotaWindows(g).length > 0) || list[0];
  }

  const REFRESHING_L = ['即将刷新', '即將重設', 'Refreshing', '間もなく更新', '곧 초기화', 'Actualizando', 'Actualisation', 'Aktualisiert'];

  function fmtEtaSec(totalSec, l) {
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    if (l === 'zh-CN') return d > 0 ? `${d}天${h}小时` : h > 0 ? `${h}小时${m}分` : `${Math.max(1, m)}分钟`;
    if (l === 'zh-TW') return d > 0 ? `${d}天${h}小時` : h > 0 ? `${h}小時${m}分` : `${Math.max(1, m)}分鐘`;
    if (l === 'ja') return d > 0 ? `${d}日${h}時間` : h > 0 ? `${h}時間${m}分` : `${Math.max(1, m)}分`;
    if (l === 'ko') return d > 0 ? `${d}일 ${h}시간` : h > 0 ? `${h}시간 ${m}분` : `${Math.max(1, m)}분`;
    if (l === 'fr') return d > 0 ? `${d}j ${h}h` : h > 0 ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
    if (l === 'de') return d > 0 ? `${d}T ${h}Std` : h > 0 ? `${h}Std ${m}m` : `${Math.max(1, m)}m`;
    return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
  }

  function shortEta(ms, langOrZh) {
    const l = resolveLang(langOrZh);
    const v = numOr(ms);
    if (!(v > 0) || !Number.isFinite(v)) return pick8(REFRESHING_L, l);
    return fmtEtaSec(Math.max(1, Math.round(v / 1000)), l);
  }

  function quotaForecast(bucket, windowKey, nowMs = Date.now()) {
    const rem = quotaRemaining(bucket);
    if (rem === null) return null;
    const now = numOr(nowMs);
    const spanMs = windowKey === 'weekly' ? 7 * 86400 * 1000 : 5 * 3600 * 1000;
    const r0 = numOr(bucket?.resetAt ?? bucket?.resetTime);
    const resetMs = typeof r0 === 'number' ? (r0 > 1e11 ? r0 : r0 * 1000) : (tsToMs(r0) || NaN);

    if (!Number.isFinite(resetMs) || resetMs <= now) {
      return {
        window: windowKey,
        remaining: rem,
        endRemaining: rem,
        forecastDrop: 0,
        willExhaust: false,
        exhaustInMs: null,
        paceRatio: 0,
        status: rem < 1 ? 'ok' : 'idle',
        resetAtMs: Number.isFinite(resetMs) ? resetMs : null,
        resetInMs: 0,
      };
    }

    const leftMs = Math.max(0, Math.min(spanMs, resetMs - now));
    const elapsedMs = Math.max(0, spanMs - leftMs);
    const used = Math.max(0, 1 - rem);
    const minSmoothMs = windowKey === 'weekly' ? 2 * 3600 * 1000 : 15 * 60 * 1000;

    if (used < 0.005 || elapsedMs < 3 * 60 * 1000) {
      return {
        window: windowKey,
        remaining: rem,
        endRemaining: rem,
        forecastDrop: 0,
        willExhaust: rem <= 0.005,
        exhaustInMs: rem <= 0.005 ? 0 : null,
        paceRatio: 0,
        status: rem <= 0.005 ? 'exhaust' : 'idle',
        resetAtMs: resetMs,
        resetInMs: leftMs,
      };
    }

    const burnPerMs = used / Math.max(elapsedMs, minSmoothMs);
    const projectedExtra = burnPerMs * leftMs;
    const endRemaining = Math.max(0, Math.min(rem, rem - projectedExtra));
    const forecastDrop = Math.max(0, rem - endRemaining);
    const idealUsed = spanMs > 0 ? elapsedMs / spanMs : 0;
    const paceRatio = idealUsed > 0.02 ? used / idealUsed : used / 0.02;
    const timeToZeroMs = burnPerMs > 0 ? rem / burnPerMs : Infinity;
    const willExhaust = rem <= 0.01 || (timeToZeroMs < leftMs * 0.95 && used >= 0.06);

    let status = 'ok';
    if (willExhaust) status = 'exhaust';
    else if (paceRatio > 1.18 && used >= 0.05) status = 'tight';
    else if (used < 0.01) status = 'idle';

    return {
      window: windowKey,
      remaining: rem,
      endRemaining,
      forecastDrop,
      willExhaust,
      exhaustInMs: Number.isFinite(timeToZeroMs) && willExhaust ? Math.max(0, Math.round(timeToZeroMs)) : null,
      paceRatio: Number(paceRatio.toFixed(2)),
      status,
      resetAtMs: resetMs,
      resetInMs: leftMs,
    };
  }

  function groupQuotaPace(group, langOrZh, nowMs = Date.now()) {
    const l = resolveLang(langOrZh);
    const wins = quotaWindows(group);
    const forecasts = wins.map(([wk, b]) => quotaForecast(b, wk, nowMs)).filter(Boolean);
    const rank = { exhaust: 3, tight: 2, ok: 1, idle: 0 };
    let primary = null;
    for (const f of forecasts) {
      if (!primary || (rank[f.status] ?? 0) > (rank[primary.status] ?? 0)) primary = f;
    }
    const status = primary ? primary.status : 'idle';
    const label = pick8(
      status === 'exhaust'
        ? ['提前耗尽', '提前耗盡', 'Depleting early', '早期枯渇予測', '조기 소진 예상', 'Se agota pronto', 'Épuisement rapide', 'Bald erschöpft']
        : status === 'tight'
        ? ['配速偏紧', '配速偏緊', 'Burning fast', '消費やや速め', '소모 빠름', 'Consumo rápido', 'Conso rapide', 'Hoher Verbrauch']
        : status === 'ok'
        ? ['配额充裕', '配額充裕', 'On track', 'ペース良好', '정상 페이스', 'En rango', 'Dans les temps', 'Im Plan']
        : ['待命充裕', '待命充裕', 'Standby', '待機中', '대기 중', 'En espera', 'En veille', 'Bereit'],
      l
    );
    let detail = '';
    if (primary) {
      if (primary.willExhaust && primary.exhaustInMs !== null) {
        const eta = shortEta(primary.exhaustInMs, l);
        detail = pick8([`预计 ${eta}后耗尽`, `預計 ${eta}後耗盡`, `Est. empty in ${eta}`, `約${eta}で枯渇予測`, `약 ${eta} 후 소진`, `Se agota en ~${eta}`, `Vide dans ~${eta}`, `Leer in ~${eta}`], l);
      } else if (primary.resetInMs > 0) {
        const eta = shortEta(primary.resetInMs, l);
        const endPct = Math.round(primary.endRemaining * 100);
        detail = pick8([`${eta}后重置 · 预计结余 ${endPct}%`, `${eta}後重設 · 預計結餘 ${endPct}%`, `Resets in ${eta} · Est. ${endPct}% left`, `${eta}後に更新 · 予測残 ${endPct}%`, `${eta} 후 초기화 · 예상 잔여 ${endPct}%`, `Reinicio en ${eta} · Est. ${endPct}%`, `Reset dans ${eta} · Est. ${endPct}%`, `Reset in ${eta} · Ca. ${endPct}%`], l);
      }
    }
    return {
      status,
      label,
      detail,
      primary,
      forecasts,
    };
  }

  function axisMax(peak) {
    const p = numOr(peak);
    if (!(p > 0)) return 0;
    const magnitude = Math.pow(10, Math.floor(Math.log(p) / Math.LN10));
    const scaled = p / magnitude;
    const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10;
    return step * magnitude;
  }

  function homeChartTicks(widths, axisWidth, gap = 8, columnGap = 2) {
    const count = widths.length;
    if (count === 0 || !(axisWidth > 0)) return [];
    const column = (axisWidth - columnGap * (count - 1)) / count;
    if (!(column > 0)) return [];
    let widest = 0;
    for (let i = 0; i < count; i++) {
      if (widths[i] > widest) widest = widths[i];
    }
    const edgeShift = Math.max(0, widest / 2 - column / 2);
    let step = 1;
    while (step < count && step * (column + columnGap) < widest + gap + edgeShift) step += 1;
    const boxes = [];
    for (let i = count - 1; i >= 0; i -= step) {
      const width = widths[i];
      const centre = i * (column + columnGap) + column / 2;
      const left = Math.min(Math.max(centre - width / 2, 0), Math.max(axisWidth - width, 0));
      boxes.unshift({ index: i, left });
    }
    const kept = [];
    for (let i = boxes.length - 1; i >= 0; i--) {
      const box = boxes[i];
      const next = kept[0];
      if (next === undefined || box.left + widths[box.index] + gap <= next.left) kept.unshift(box);
    }
    return kept;
  }

  function createHomeModelColours() {
    const assigned = new Map();
    function preferred(id) {
      let hash = 2166136261;
      for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
      return (hash >>> 0) % HOME_MODEL_COLOUR_COUNT;
    }
    return function assign(ids) {
      const unique = Array.from(new Set(ids)).sort();
      const out = {};
      for (let i = 0; i < unique.length; i++) {
        const id = unique[i];
        if (assigned.has(id)) {
          out[id] = assigned.get(id);
          continue;
        }
        const used = new Set(assigned.values());
        let colour = preferred(id);
        while (used.size < HOME_MODEL_COLOUR_COUNT && used.has(colour)) {
          colour = (colour + 1) % HOME_MODEL_COLOUR_COUNT;
        }
        assigned.set(id, colour);
        out[id] = colour;
      }
      return out;
    };
  }

  function durSec(d) {
    if (!d) return 0;
    return typeof d === 'object' ? toNum(d.seconds) + toNum(d.nanos) / 1e9 : toNum(d);
  }

  function tsSec(ts) {
    if (!ts) return 0;
    if (typeof ts === 'string') { const ms = Date.parse(ts); return Number.isFinite(ms) ? ms / 1000 : toNum(ts); }
    return typeof ts === 'object' ? toNum(ts.seconds) + toNum(ts.nanos) / 1e9 : toNum(ts);
  }

  function fmtK(n) {
    const v = toNum(n);
    if (v >= 1000000) return (v / 1000000).toFixed(2) + 'M';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
    return String(Math.round(v));
  }

  function fmtInt(n) {
    return toNum(n).toLocaleString();
  }

  function fmtPct(p, digits = 1) {
    const v = toNum(p);
    return v.toFixed(digits) + '%';
  }

  function fmtSec(s) {
    const v = toNum(s);
    if (v <= 0) return '—';
    if (v < 1) return Math.round(v * 1000) + 'ms';
    return v.toFixed(1) + 's';
  }

  function fmtResetTime(tsSeconds, langOrZh, nowSec) {
    const n0 = numOr(nowSec);
    const now = typeof n0 === 'number' ? n0 : Date.now() / 1000;
    const sec = (tsSeconds && typeof tsSeconds === 'object' ? tsSec(tsSeconds) : toNum(tsSeconds)) - now;
    const l = resolveLang(langOrZh);
    return sec <= 0 ? pick8(REFRESHING_L, l) : fmtEtaSec(sec, l);
  }

  return {
    HOME_HEAT_WEEKS,
    HOME_HEAT_RAMP,
    HOME_HEAT_STEPS,
    HOME_CHART_DAYS,
    HOME_MODEL_ROWS,
    HOME_RANGES,
    HOME_BOOKS,
    resolveLang,
    homeRangeLabel,
    homeBookTitle,
    homeDayKey,
    homeRangeStart,
    formatHomeCount,
    formatCompactTokens,
    formatHomeHour,
    homeShortDateFormat,
    homeShortDate,
    isSubagentSummary,
    extractWorkspaceId,
    analyzeTrajectoryForUsage,
    mergeUsageRecordDelta,
    homeHeatGrid,
    aggregateUsageRollup,
    quotaGroupKind,
    quotaGroupLabel,
    quotaRemaining,
    quotaWindows,
    chooseQuotaGroup,
    shortEta,
    quotaForecast,
    groupQuotaPace,
    axisMax,
    homeChartTicks,
    createHomeModelColours,
    durSec,
    tsSec,
    fmtK,
    fmtInt,
    fmtPct,
    fmtSec,
    fmtResetTime,
  };
});
