<template>
  <section class="page" data-module="dashboardboard">
    <header class="page-head">
      <div>
        <h2>自助看板管理</h2>
        <p class="page-desc">搭建自助分析看板，拖拽组合多个图表到自定义布局中。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">创建看板组合</button>
        <button class="btn" type="button" @click="exportRows">导出自助看板清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <section v-if="showCreate" class="create-panel">
      <h3>创建看板组合</h3>
      <p class="page-desc">
        选择图表组、布局和刷新节奏，确认后生成可分享内容。冲突策略：{{ refreshPolicy }}。
      </p>
      <div class="form-grid">
        <label class="form-item">
          <span>看板名称</span>
          <input v-model="formName" placeholder="例如：运营监控看板" />
        </label>
        <label class="form-item">
          <span>布局列数</span>
          <select v-model.number="formCols">
            <option v-for="option in [1, 2, 3, 4]" :key="option" :value="option">{{ option }} 列</option>
          </select>
        </label>
        <label class="form-item">
          <span>自动刷新秒（0 表示关闭）</span>
          <input v-model.number="formRefresh" type="number" min="0" max="3600" />
        </label>
        <label class="form-item">
          <span>全屏模式</span>
          <select v-model="formFullscreen">
            <option>否</option>
            <option>是</option>
          </select>
        </label>
        <label class="form-item">
          <span>背景主题</span>
          <select v-model="formTheme">
            <option>浅色</option>
            <option>深色</option>
          </select>
        </label>
        <label class="form-item">
          <span>额外引用（可填尚未存在的配置编号）</span>
          <input v-model="formExtra" placeholder="例如 CHAR-0009，用于演示失效引用" />
        </label>
      </div>
      <fieldset class="chart-picker">
        <legend>选择图表组（按勾选顺序排列）</legend>
        <label v-for="option in chartOptions" :key="option.code" class="chart-option">
          <input
            type="checkbox"
            :checked="formRefs.includes(option.code)"
            @change="toggleRef(option.code)"
          />
          {{ option.code }} · {{ option.name }}（{{ option.status }}）
        </label>
        <span v-if="!chartOptions.length" class="empty-state">图表构建模块暂无配置</span>
      </fieldset>
      <div class="panel-actions">
        <button class="btn primary" type="button" @click="confirmCreate">确认生成组合</button>
        <button class="btn ghost" type="button" @click="showCreate = false">取消</button>
      </div>
    </section>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <RouterLink
              v-if="column === '分享链接' && isShareUrl(row[column])"
              :to="String(row[column])"
            >
              打开分享视图
            </RouterLink>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="generateShare(row)">生成分享组合</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无自助看板数据，可先创建看板组合</td>
        </tr>
      </tbody>
    </table>

    <section class="combo-panel">
      <h3>看板组合数据快照</h3>
      <p class="page-desc">
        每次生成的组合快照都会保留，已经可访问的看板版本不回退；重复提交同一布局直接复用，不额外生成分享内容。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>组合编号</th>
            <th>看板</th>
            <th>组合版本</th>
            <th>图表（有效/失效）</th>
            <th>布局列数</th>
            <th>刷新秒</th>
            <th>生成时间</th>
            <th>分享入口</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="combo in combos" :key="combo.comboId">
            <td>{{ combo.comboId }}</td>
            <td>{{ combo.dashboardName }}（{{ combo.layoutId }}）</td>
            <td>{{ combo.versionLabel }}</td>
            <td>{{ validChartCount(combo) }} / {{ invalidChartCount(combo) }}</td>
            <td>{{ combo.layoutColumns }}</td>
            <td>{{ combo.refreshSeconds }}</td>
            <td>{{ combo.createdAt }}</td>
            <td><RouterLink :to="shareUrl(combo)">打开分享视图</RouterLink></td>
          </tr>
          <tr v-if="!combos.length">
            <td colspan="8" class="empty-state">暂无组合快照，可在看板行上执行「生成分享组合」</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条自助看板记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  REFRESH_POLICY,
  createDashboardAndCombo,
  generateCombo,
  listCombos,
  shareUrlFor,
  type DashboardCombo,
} from '@/api/dashboard-combo'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('dashboardboard')
const columns = ["布局编号", "看板名称", "包含图表组", "布局列数", "自动刷新秒", "全屏模式", "分享链接", "背景主题"]
const actions = ["提交构建", "发布看板", "下线看板"]
const statuses = ["草稿", "看板构建中", "已发布", "已下线"]
const stats = [{"label": "看板布局总数", "value": 0}, {"label": "已发布看板", "value": 0}, {"label": "构建中看板", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const refreshPolicy = REFRESH_POLICY
const combos = ref<DashboardCombo[]>([])

const showCreate = ref(false)
const formName = ref('')
const formRefs = ref<string[]>([])
const formExtra = ref('')
const formCols = ref(2)
const formRefresh = ref(30)
const formFullscreen = ref('否')
const formTheme = ref('浅色')

const chartOptions = computed(() =>
  listEntries('chartbuilder').items.map((row) => ({
    code: String(row['配置编号'] ?? ''),
    name: String(row['图表名称'] ?? ''),
    status: String(row.status ?? ''),
  })),
)

function isShareUrl(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('/share/view/')
}

function shareUrl(combo: DashboardCombo): string {
  return shareUrlFor(combo.comboId)
}

function validChartCount(combo: DashboardCombo): number {
  return combo.charts.filter((chart) => chart.valid).length
}

function invalidChartCount(combo: DashboardCombo): number {
  return combo.charts.filter((chart) => !chart.valid).length
}

function toggleRef(code: string) {
  const index = formRefs.value.indexOf(code)
  if (index >= 0) {
    formRefs.value.splice(index, 1)
  } else {
    formRefs.value.push(code)
  }
}

function openCreate() {
  errorMessage.value = ''
  noticeMessage.value = ''
  showCreate.value = true
}

function confirmCreate() {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = createDashboardAndCombo({
    name: formName.value,
    chartRefs: [...formRefs.value],
    extraRefs: formExtra.value,
    layoutColumns: Number(formCols.value),
    refreshSeconds: Number(formRefresh.value),
    fullscreen: formFullscreen.value === '是',
    theme: formTheme.value,
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  showCreate.value = false
  formName.value = ''
  formRefs.value = []
  formExtra.value = ''
  reload()
  reloadCombos()
}

function generateShare(row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = generateCombo(Number(row.id))
  if (!result.ok) {
    errorMessage.value = result.message
    reloadCombos()
    return
  }
  noticeMessage.value = result.message
  reload()
  reloadCombos()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '自助看板列表读取失败'
  }
}

function reloadCombos() {
  combos.value = listCombos()
}

onMounted(() => {
  reload()
  reloadCombos()
})
</script>
