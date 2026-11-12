/**
 * 失败线路记忆：某条线路（站点 + 线路名）播不动就记一笔，
 * 下次进详情页直接把它排到后面，不用每次都先踩一遍坑。
 *
 * 记录很轻，只存失败次数与最后失败时间；时间久了（24 小时）权重自动衰减，
 * 避免某次网络抽风导致一条好线路被永久打入冷宫。
 */
const KEY = 'miralite.line.fails.v1'

interface FailRecord {
  /** 累计失败次数 */
  n: number
  /** 最后一次失败时间戳 */
  at: number
}

/** 24 小时衰减窗口：超过这个时间没再失败，视为「可能恢复了」 */
const DECAY_MS = 24 * 60 * 60 * 1000
/** 失败后多久内不再优先尝试 */
const COOLDOWN_MS = 30 * 60 * 1000

type Store = Record<string, FailRecord>

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const v: unknown = JSON.parse(raw)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    return v as Store
  } catch {
    return {}
  }
}

function write(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    /* 存不下只是少个加速，不影响播放 */
  }
}

export function lineKey(siteKey: string, flag: string): string {
  return `${siteKey}::${flag}`
}

/** 记一次线路失败 */
export function markLineFailed(siteKey: string, flag: string): void {
  const store = read()
  const k = lineKey(siteKey, flag)
  const prev = store[k]
  const fresh = prev && Date.now() - prev.at < DECAY_MS ? prev.n : 0
  store[k] = { n: fresh + 1, at: Date.now() }
  write(store)
}

/** 线路播通了，清掉历史失败 */
export function clearLineFailed(siteKey: string, flag: string): void {
  const store = read()
  const k = lineKey(siteKey, flag)
  if (!store[k]) return
  delete store[k]
  write(store)
}

/**
 * 线路健康分：越大越不建议优先用。
 * 刚失败过的线（30 分钟内）给高权重，正在冷却；老失败记录权重逐渐回落。
 */
export function linePenalty(siteKey: string, flag: string): number {
  const rec = read()[lineKey(siteKey, flag)]
  if (!rec) return 0
  const age = Date.now() - rec.at
  if (age > DECAY_MS) return 0
  const decay = 1 - age / DECAY_MS
  const cooling = age < COOLDOWN_MS ? 2 : 1
  return rec.n * decay * cooling
}

/** 把所有线路按健康度排序，返回下标数组；分数相同保持原顺序 */
export function rankLineIndexes(
  siteKey: string,
  lines: { flag: string; episodes: { id: string; name: string }[] }[],
): number[] {
  return lines
    .map((l, i) => ({ i, score: linePenalty(siteKey, l.flag) }))
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .map((x) => x.i)
}

/** 清掉全部线路失败记录（设置页「重置线路偏好」用） */
export function clearAllLineFails(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

/** 统计有多少条线路带着失败记录，设置页展示用 */
export function failedLineCount(): number {
  return Object.keys(read()).length
}
