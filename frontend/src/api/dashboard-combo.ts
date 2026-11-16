import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

/**
 * 看板组合数据快照服务。
 *
 * 背景：看板分享后内容会随基础图表变化，访问者无法说明自己看到的是哪一版图表组合。
 * 这里把看板布局（看板名称、包含图表组、布局列数、自动刷新秒、全屏模式、背景主题）
 * 解析成一份不可变的「看板组合数据快照」，分享链接、自动刷新、分享管理核验都读同一份
 * 快照，保证看板名称、包含图表组、布局列数和来源配置可以逐项复核。
 *
 * 冲突决策（需求留白，由实现确定并固化在这里）：看板布局在
 * 「优先跟随看板刷新周期」与「优先等待图表数据就绪」之间冲突时，
 * 采用「优先跟随看板刷新周期」——到点即按看板刷新周期刷新；单张图表未就绪只标注
 * 该图表并保留其余图表，不阻塞整屏、不清空已就绪内容；没有新组合数据时当前画面保持。
 */
export const REFRESH_POLICY = '优先跟随看板刷新周期（未就绪图表单独标注，不清空已就绪内容）'

const COMBO_STORAGE_KEY = 'data-explore-selfservice:dashboard-combos'
const SHARE_VIEW_PREFIX = '/share/view/'

export type ComboChartItem = {
  /** 排列顺序，从 1 开始，与看板布局中的书写顺序一致 */
  order: number
  /** 看板布局「包含图表组」里的原始引用文本 */
  ref: string
  /** 配置编号（失效引用时等于原始引用文本） */
  configId: string
  chartName: string
  chartType: string
  /** 来源配置：图表的数据查询绑定 */
  dataSource: string
  /** 生成快照时的字段映射版本 */
  fieldMappingVersion: string
  /** true=图表组真正包含的配置；false=已失效引用 */
  valid: boolean
}

export type ComboSourceRecord = {
  layoutId: string
  dashboardName: string
  /** 生成快照时看板布局的状态 */
  layoutStatus: string
  /** 包含图表组原文 */
  chartGroupRaw: string
  generatedBy: string
  generatedAt: string
}

export type DashboardCombo = {
  comboId: string
  /** 来源布局编号 */
  layoutId: string
  dashboardName: string
  /** 该看板第几版组合，单调递增，已生成版本不回退 */
  version: number
  versionLabel: string
  /** 幂等指纹：同一布局内容重复提交时不额外生成分享内容 */
  contentHash: string
  chartGroupRaw: string
  layoutColumns: number
  refreshSeconds: number
  fullscreen: boolean
  theme: string
  refreshPolicy: string
  charts: ComboChartItem[]
  source: ComboSourceRecord
  createdAt: string
}

export type ComboGenResult = {
  ok: boolean
  /** true 表示命中幂等，复用了已有快照，没有额外生成分享内容 */
  reused?: boolean
  message: string
  combo?: DashboardCombo
}

export type ChartReadiness = {
  state: 'ready' | 'pending' | 'missing'
  label: string
  detail: string
  liveFieldMappingVersion?: string
  /** 看板侧配置已更新，但分享视图保持快照版本 */
  configChanged: boolean
}

export type ShareChecklistItem = {
  name: string
  state: 'ok' | 'warn' | 'fail'
  detail: string
}

export type ShareChecklistResult = {
  ok: boolean
  message?: string
  items: ShareChecklistItem[]
  combo?: DashboardCombo
}

export type NewComboInput = {
  name: string
  chartRefs: string[]
  extraRefs: string
  layoutColumns: number
  refreshSeconds: number
  fullscreen: boolean
  theme: string
}

function nowText(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

function hashText(text: string): string {
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0
  }
  return hash.toString(36).toUpperCase().padStart(7, '0')
}

/** 字段映射版本：由图表类型与 X/Y/分组字段映射决定，配置一改版本号就变。 */
export function fieldMappingVersion(chartRow: EntryRow): string {
  const material = ['图表类型', 'X轴字段', 'Y轴字段', '分组字段']
    .map((field) => String(chartRow[field] ?? ''))
    .join('|')
  return `FM-${hashText(material).slice(0, 5)}`
}

/** 解析看板布局的「包含图表组」，保留书写顺序。 */
export function parseChartGroup(raw: string): string[] {
  return raw
    .split(/[,，、;；|\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
}

function findChart(configId: string): EntryRow | undefined {
  return listRows('chartbuilder').find((row) => String(row['配置编号'] ?? '') === configId)
}

function buildCharts(tokens: string[]): ComboChartItem[] {
  return tokens.map((token, index) => {
    const chart = findChart(token)
    if (!chart) {
      return {
        order: index + 1,
        ref: token,
        configId: token,
        chartName: '（未知图表）',
        chartType: '—',
        dataSource: '—',
        fieldMappingVersion: '—',
        valid: false,
      }
    }
    return {
      order: index + 1,
      ref: token,
      configId: String(chart['配置编号'] ?? token),
      chartName: String(chart['图表名称'] ?? token),
      chartType: String(chart['图表类型'] ?? '—'),
      dataSource: String(chart['数据查询绑定'] ?? '—'),
      fieldMappingVersion: fieldMappingVersion(chart),
      valid: true,
    }
  })
}

function comboContentHash(parts: {
  layoutId: string
  chartGroupRaw: string
  layoutColumns: number
  refreshSeconds: number
  fullscreen: boolean
  theme: string
  charts: ComboChartItem[]
}): string {
  const material = JSON.stringify({
    layoutId: parts.layoutId,
    chartGroupRaw: parts.chartGroupRaw,
    layoutColumns: parts.layoutColumns,
    refreshSeconds: parts.refreshSeconds,
    fullscreen: parts.fullscreen,
    theme: parts.theme,
    charts: parts.charts.map((chart) =>
      [chart.ref, chart.configId, chart.dataSource, chart.fieldMappingVersion].join(':'),
    ),
  })
  return hashText(material)
}

let comboCache: DashboardCombo[] | null = null

function readCombos(): DashboardCombo[] {
  if (comboCache !== null) {
    return comboCache
  }
  let combos: DashboardCombo[] = []
  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = window.localStorage.getItem(COMBO_STORAGE_KEY)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as DashboardCombo[]
        combos = Array.isArray(parsed) ? parsed : []
      } catch {
        combos = []
      }
    }
  }
  comboCache = combos
  return combos
}

function writeCombos(combos: DashboardCombo[]): void {
  comboCache = combos
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(COMBO_STORAGE_KEY, JSON.stringify(combos))
  }
}

export function listCombos(): DashboardCombo[] {
  return [...readCombos()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function getCombo(comboId: string): DashboardCombo | undefined {
  return readCombos().find((combo) => combo.comboId === comboId)
}

export function combosForLayout(layoutId: string): DashboardCombo[] {
  return readCombos()
    .filter((combo) => combo.layoutId === layoutId)
    .sort((a, b) => b.version - a.version)
}

export function latestComboForLayout(layoutId: string): DashboardCombo | undefined {
  return combosForLayout(layoutId)[0]
}

export function shareUrlFor(comboId: string): string {
  return `${SHARE_VIEW_PREFIX}${comboId}`
}

function nextComboId(combos: DashboardCombo[]): string {
  const maxSeq = combos.reduce((max, combo) => {
    const matched = /^COMBO-(\d+)$/.exec(combo.comboId)
    return matched ? Math.max(max, Number(matched[1])) : max
  }, 0)
  return `COMBO-${String(maxSeq + 1).padStart(4, '0')}`
}

/** 分享管理同步到同一份组合快照：同一组合只登记一条链接，不重复建行。 */
function upsertShareEntry(combo: DashboardCombo): void {
  const rows = listRows('sharelink')
  const url = shareUrlFor(combo.comboId)
  if (rows.some((row) => String(row['链接URL'] ?? '') === url)) {
    return
  }
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const entry: EntryRow = {
    id: nextId,
    status: '已生成',
    pending: true,
    abnormal: false,
    链接编号: `SHAR-${String(nextId).padStart(4, '0')}`,
    分享内容: `看板「${combo.dashboardName}」组合 ${combo.versionLabel}`,
    链接URL: url,
    访问密码: '无',
    有效期至: '长期',
    访问次数: '0',
    下载开关: '关',
    创建时间: combo.createdAt.slice(0, 10),
  }
  saveRows('sharelink', [...rows, entry])
}

function updateLayoutShareUrl(layoutRowId: number, url: string): void {
  const rows = listRows('dashboardboard')
  const index = rows.findIndex((row) => Number(row.id) === layoutRowId)
  if (index < 0) {
    return
  }
  const next = [...rows]
  next[index] = { ...rows[index], 分享链接: url }
  saveRows('dashboardboard', next)
}

/**
 * 解析看板布局并生成看板组合数据快照。
 * - 快照保存看板名称、包含图表组、布局列数、自动刷新秒、全屏模式与来源记录，可逐项复核；
 * - 每张图表保留配置编号与当前字段映射版本，失效引用单独标注；
 * - 同一布局内容重复提交直接复用已有快照，不额外生成分享内容；
 * - 生成失败时保留前一份可用快照，已经可访问的看板版本不回退。
 */
export function generateCombo(layoutRowId: number): ComboGenResult {
  const layout = listRows('dashboardboard').find((row) => Number(row.id) === layoutRowId)
  if (!layout) {
    return { ok: false, message: `没有找到编号为 ${layoutRowId} 的看板布局` }
  }
  const layoutId = String(layout['布局编号'] ?? '')
  const dashboardName = String(layout['看板名称'] ?? layoutId)
  const chartGroupRaw = String(layout['包含图表组'] ?? '')
  const charts = buildCharts(parseChartGroup(chartGroupRaw))
  const validCount = charts.filter((chart) => chart.valid).length
  if (validCount === 0) {
    const kept = latestComboForLayout(layoutId)
    return {
      ok: false,
      combo: kept,
      message: kept
        ? `看板「${dashboardName}」未解析到任何有效图表配置，分享内容生成失败，已保留前一份可用看板组合快照 ${kept.comboId}（${kept.versionLabel}）`
        : `看板「${dashboardName}」未解析到任何有效图表配置，分享内容生成失败，当前没有可用快照可保留`,
    }
  }
  const layoutColumns = Math.max(1, Number(layout['布局列数']) || 1)
  const refreshSeconds = Math.max(0, Number(layout['自动刷新秒']) || 0)
  const fullscreen = String(layout['全屏模式'] ?? '') === '是'
  const theme = String(layout['背景主题'] ?? '浅色')
  const contentHash = comboContentHash({
    layoutId,
    chartGroupRaw,
    layoutColumns,
    refreshSeconds,
    fullscreen,
    theme,
    charts,
  })
  const combos = readCombos()
  const duplicated = combos.find(
    (combo) => combo.layoutId === layoutId && combo.contentHash === contentHash,
  )
  if (duplicated) {
    upsertShareEntry(duplicated)
    updateLayoutShareUrl(layoutRowId, shareUrlFor(duplicated.comboId))
    return {
      ok: true,
      reused: true,
      combo: duplicated,
      message: `同一布局内容已生成过分享内容，直接复用 ${duplicated.comboId}（${duplicated.versionLabel}），未额外生成`,
    }
  }
  const version =
    combos
      .filter((combo) => combo.layoutId === layoutId)
      .reduce((max, combo) => Math.max(max, combo.version), 0) + 1
  const combo: DashboardCombo = {
    comboId: nextComboId(combos),
    layoutId,
    dashboardName,
    version,
    versionLabel: `V${version}`,
    contentHash,
    chartGroupRaw,
    layoutColumns,
    refreshSeconds,
    fullscreen,
    theme,
    refreshPolicy: REFRESH_POLICY,
    charts,
    source: {
      layoutId,
      dashboardName,
      layoutStatus: String(layout.status ?? ''),
      chartGroupRaw,
      generatedBy: '自助看板-生成分享组合',
      generatedAt: nowText(),
    },
    createdAt: nowText(),
  }
  writeCombos([...combos, combo])
  upsertShareEntry(combo)
  updateLayoutShareUrl(layoutRowId, shareUrlFor(combo.comboId))
  return {
    ok: true,
    combo,
    message: `已生成看板组合数据快照 ${combo.comboId}（${combo.versionLabel}），分享管理已同步同一链接`,
  }
}

/**
 * 创建看板组合：选择图表组、布局和刷新节奏，确认后生成可分享内容。
 * 相同内容的布局已存在时不重复登记，直接复用其组合快照。
 */
export function createDashboardAndCombo(input: NewComboInput): ComboGenResult & { layoutRowId?: number } {
  const name = input.name.trim()
  if (!name) {
    return { ok: false, message: '请填写看板名称' }
  }
  const refs = [...input.chartRefs, ...parseChartGroup(input.extraRefs)]
  if (refs.length === 0) {
    return { ok: false, message: '请至少选择一个图表配置作为图表组' }
  }
  if (!Number.isFinite(input.layoutColumns) || input.layoutColumns < 1 || input.layoutColumns > 6) {
    return { ok: false, message: '布局列数需要在 1 到 6 之间' }
  }
  if (!Number.isFinite(input.refreshSeconds) || input.refreshSeconds < 0 || input.refreshSeconds > 3600) {
    return { ok: false, message: '自动刷新秒需要在 0 到 3600 之间（0 表示关闭自动刷新）' }
  }
  const chartGroupRaw = refs.join(',')
  const rows = listRows('dashboardboard')
  const columnsText = String(input.layoutColumns)
  const refreshText = String(input.refreshSeconds)
  const fullscreenText = input.fullscreen ? '是' : '否'
  const duplicated = rows.find(
    (row) =>
      String(row['看板名称'] ?? '') === name &&
      String(row['包含图表组'] ?? '') === chartGroupRaw &&
      String(row['布局列数'] ?? '') === columnsText &&
      String(row['自动刷新秒'] ?? '') === refreshText &&
      String(row['全屏模式'] ?? '') === fullscreenText &&
      String(row['背景主题'] ?? '') === input.theme,
  )
  if (duplicated) {
    const result = generateCombo(Number(duplicated.id))
    return {
      ...result,
      layoutRowId: Number(duplicated.id),
      message: `相同布局已存在（${String(duplicated['布局编号'] ?? '')}），未重复登记。${result.message}`,
    }
  }
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const row: EntryRow = {
    id: nextId,
    status: '草稿',
    pending: true,
    abnormal: false,
    布局编号: `DASH-${String(nextId).padStart(4, '0')}`,
    看板名称: name,
    包含图表组: chartGroupRaw,
    布局列数: columnsText,
    自动刷新秒: refreshText,
    全屏模式: fullscreenText,
    分享链接: '未生成',
    背景主题: input.theme,
  }
  saveRows('dashboardboard', [...rows, row])
  const result = generateCombo(nextId)
  return { ...result, layoutRowId: nextId }
}

/**
 * 评估单张图表的当前就绪状态。只影响后续展示：未就绪的图表单独标注，
 * 其余图表继续展示，整屏内容不会被替换成空白。
 */
export function evaluateReadiness(item: ComboChartItem): ChartReadiness {
  if (!item.valid) {
    return {
      state: 'missing',
      label: '已失效引用',
      detail: `看板布局中的引用「${item.ref}」在图表构建中不存在，属于已失效引用，来源已标明`,
      configChanged: false,
    }
  }
  const live = findChart(item.configId)
  if (!live) {
    return {
      state: 'missing',
      label: '已失效引用',
      detail: `配置 ${item.configId} 已被删除，组合快照保留其来源记录`,
      configChanged: false,
    }
  }
  const liveVersion = fieldMappingVersion(live)
  const configChanged = liveVersion !== item.fieldMappingVersion
  if (String(live.status ?? '') === '已发布') {
    return {
      state: 'ready',
      label: '就绪',
      detail: configChanged ? '看板侧配置已有新版本，分享视图保持快照版本' : '数据已就绪',
      liveFieldMappingVersion: liveVersion,
      configChanged,
    }
  }
  return {
    state: 'pending',
    label: '尚未就绪',
    detail: `图表配置当前状态「${String(live.status ?? '')}」，数据尚未就绪，其余图表继续展示`,
    liveFieldMappingVersion: liveVersion,
    configChanged,
  }
}

/** 分享访问登记：打开分享视图时累计访问次数。 */
export function registerShareVisit(comboId: string): void {
  const url = shareUrlFor(comboId)
  const rows = listRows('sharelink')
  const index = rows.findIndex((row) => String(row['链接URL'] ?? '') === url)
  if (index < 0) {
    return
  }
  const visits = Number(rows[index]['访问次数']) || 0
  const next = [...rows]
  next[index] = { ...rows[index], 访问次数: String(visits + 1) }
  saveRows('sharelink', next)
}

/**
 * 其他链路分享管理的独立分享核验清单：核验分享链接与看板组合快照引用一致、
 * 图表组来源同步、看板版本同步、展示语义完整、每张图表配置版本可追溯。
 */
export function buildShareChecklist(shareRowId: number): ShareChecklistResult {
  const row = listRows('sharelink').find((item) => Number(item.id) === shareRowId)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${shareRowId} 的分享链接`, items: [] }
  }
  const url = String(row['链接URL'] ?? '')
  const matched = new RegExp(`^${SHARE_VIEW_PREFIX}(COMBO-\\d+)$`).exec(url)
  if (!matched) {
    return { ok: false, message: '该链接不关联看板组合快照，仅看板组合分享支持核验清单', items: [] }
  }
  const combo = getCombo(matched[1])
  if (!combo) {
    return {
      ok: true,
      items: [
        { name: '组合快照存在', state: 'fail', detail: `快照 ${matched[1]} 不存在，链接已不可用` },
      ],
    }
  }
  const items: ShareChecklistItem[] = [
    {
      name: '组合快照存在',
      state: 'ok',
      detail: `${combo.comboId}（${combo.versionLabel}）已保存，已经可访问的看板版本不回退`,
    },
    {
      name: '分享引用与快照一致',
      state: url === shareUrlFor(combo.comboId) ? 'ok' : 'fail',
      detail: `链接URL「${url}」指向组合 ${combo.comboId}`,
    },
  ]
  const layout = listRows('dashboardboard').find(
    (item) => String(item['布局编号'] ?? '') === combo.layoutId,
  )
  items.push({
    name: '看板布局来源记录',
    state: layout ? 'ok' : 'warn',
    detail: layout
      ? `来源布局 ${combo.source.layoutId}「${combo.source.dashboardName}」，生成时状态「${combo.source.layoutStatus}」`
      : `来源布局 ${combo.layoutId} 已不存在，组合快照仍保留来源记录`,
  })
  if (layout) {
    const sameGroup = String(layout['包含图表组'] ?? '') === combo.chartGroupRaw
    items.push({
      name: '图表组来源同步',
      state: sameGroup ? 'ok' : 'warn',
      detail: sameGroup
        ? `图表组与看板当前配置一致：${combo.chartGroupRaw}`
        : `看板图表组已变更为「${String(layout['包含图表组'] ?? '')}」，分享仍展示快照图表组「${combo.chartGroupRaw}」`,
    })
  }
  const latest = latestComboForLayout(combo.layoutId)
  const isLatest = latest !== undefined && latest.comboId === combo.comboId
  items.push({
    name: '看板组合版本同步',
    state: isLatest ? 'ok' : 'warn',
    detail: isLatest
      ? `分享指向该看板最新组合 ${combo.versionLabel}`
      : `该看板已有更新组合 ${latest?.versionLabel ?? ''}，本分享保持 ${combo.versionLabel} 不回退`,
  })
  items.push({
    name: '展示语义完整',
    state: combo.layoutColumns > 0 && combo.refreshSeconds >= 0 ? 'ok' : 'fail',
    detail: `布局 ${combo.layoutColumns} 列 · 自动刷新 ${combo.refreshSeconds} 秒 · 全屏模式${combo.fullscreen ? '是' : '否'} · ${combo.theme}主题`,
  })
  const validCharts = combo.charts.filter((chart) => chart.valid)
  const traceable = validCharts.every(
    (chart) => chart.configId.length > 0 && chart.fieldMappingVersion !== '—',
  )
  items.push({
    name: '图表配置版本可追溯',
    state: traceable ? 'ok' : 'fail',
    detail: `${validCharts.length} 张有效图表均记录配置编号与字段映射版本`,
  })
  const invalidCharts = combo.charts.filter((chart) => !chart.valid)
  items.push({
    name: '失效引用标注',
    state: invalidCharts.length === 0 ? 'ok' : 'warn',
    detail:
      invalidCharts.length === 0
        ? '图表组内全部引用均为有效配置'
        : `${invalidCharts.length} 个已失效引用已在组合中标明来源：${invalidCharts.map((chart) => chart.ref).join('、')}`,
  })
  return { ok: true, items, combo }
}
