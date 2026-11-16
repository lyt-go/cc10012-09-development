<template>
  <section
    class="page share-view"
    :class="{ 'share-dark': combo?.fullscreen, 'share-full': fullscreenView }"
    data-module="shareview"
  >
    <template v-if="combo">
      <header class="page-head">
        <div>
          <h2>{{ combo.dashboardName }}</h2>
          <p class="page-desc">
            组合快照 {{ combo.comboId }} · 组合版本 {{ combo.versionLabel }} · 来源布局
            {{ combo.layoutId }} · 生成于 {{ combo.createdAt }}
          </p>
        </div>
        <div class="page-actions">
          <button class="btn" type="button" @click="fullscreenView = !fullscreenView">
            {{ fullscreenView ? '退出全屏视图' : '全屏查看' }}
          </button>
          <RouterLink class="btn ghost" to="/dashboardboard">返回自助看板</RouterLink>
        </div>
      </header>

      <p class="share-meta">
        <span class="legend-item">布局 {{ combo.layoutColumns }} 列</span>
        <span class="legend-item">
          自动刷新 {{ combo.refreshSeconds > 0 ? `${combo.refreshSeconds} 秒` : '关闭' }}
        </span>
        <span class="legend-item">全屏模式：{{ combo.fullscreen ? '是' : '否' }}</span>
        <span class="legend-item">背景主题：{{ combo.theme }}</span>
        <span class="legend-item">刷新策略：{{ combo.refreshPolicy }}</span>
        <span v-if="combo.refreshSeconds > 0" class="legend-item">
          距下次刷新 {{ countdown }} 秒 · 上次刷新 {{ lastRefresh }}
        </span>
      </p>

      <h3>逐项复核</h3>
      <table class="data-table review-table">
        <thead>
          <tr>
            <th>复核项</th>
            <th>组合快照值</th>
            <th>看板当前值</th>
            <th>结论</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in reviewItems" :key="item.name">
            <td>{{ item.name }}</td>
            <td>{{ item.snapshot }}</td>
            <td>{{ item.current }}</td>
            <td>
              <span class="badge" :class="item.same ? 'ok' : 'warn'">
                {{ item.same ? '一致' : '已有变更，分享保持快照' }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      <h3>图表组合（按排列顺序）</h3>
      <div class="chart-grid" :style="gridStyle">
        <article
          v-for="chart in combo.charts"
          :key="chart.order"
          class="chart-card"
          :class="readinessOf(chart).state"
        >
          <header class="chart-card-head">
            <strong>#{{ chart.order }} {{ chart.chartName }}</strong>
            <span class="badge" :class="readinessOf(chart).state">{{ readinessOf(chart).label }}</span>
          </header>
          <div v-if="readinessOf(chart).state === 'ready'" class="chart-body">
            <div class="pseudo-bars">
              <i v-for="(height, index) in barsOf(chart)" :key="index" :style="{ height: `${height}%` }"></i>
            </div>
          </div>
          <div v-else class="chart-placeholder">{{ readinessOf(chart).detail }}</div>
          <dl class="chart-meta">
            <div>
              <dt>配置编号</dt>
              <dd>{{ chart.configId }}</dd>
            </div>
            <div>
              <dt>字段映射版本</dt>
              <dd>{{ chart.fieldMappingVersion }}</dd>
            </div>
            <div>
              <dt>图表类型</dt>
              <dd>{{ chart.chartType }}</dd>
            </div>
            <div>
              <dt>来源配置</dt>
              <dd>{{ chart.dataSource }}</dd>
            </div>
          </dl>
          <p v-if="readinessOf(chart).configChanged" class="warn-text">
            看板侧已更新至 {{ readinessOf(chart).liveFieldMappingVersion }}，本分享保持快照版本
            {{ chart.fieldMappingVersion }}
          </p>
        </article>
      </div>

      <footer class="page-foot">
        <span>
          分享内容固定展示组合 {{ combo.comboId }}（{{ combo.versionLabel }}），刷新只影响后续展示，不会切换到其他版本
        </span>
      </footer>
    </template>
    <div v-else class="empty-state">
      <p>分享内容不存在或已失效：{{ comboId }}</p>
      <RouterLink to="/sharelink">返回分享管理</RouterLink>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import {
  evaluateReadiness,
  getCombo,
  registerShareVisit,
  type ChartReadiness,
  type ComboChartItem,
  type DashboardCombo,
} from '@/api/dashboard-combo'
import { listRows } from '@/data/local-store'

const route = useRoute()
const comboId = String(route.params.comboId ?? '')
const combo = ref<DashboardCombo | undefined>(getCombo(comboId))

const tick = ref(0)
const countdown = ref(0)
const lastRefresh = ref('')
const fullscreenView = ref(false)
let timer: number | undefined

const FALLBACK_READINESS: ChartReadiness = {
  state: 'missing',
  label: '未知',
  detail: '缺少该图表的快照信息',
  configChanged: false,
}

const readinessMap = computed(() => {
  // 依赖 tick：到点刷新时重新评估各图表就绪状态，只影响后续展示，不清空当前画面
  void tick.value
  const map = new Map<number, ChartReadiness>()
  for (const chart of combo.value?.charts ?? []) {
    map.set(chart.order, evaluateReadiness(chart))
  }
  return map
})

function readinessOf(chart: ComboChartItem): ChartReadiness {
  return readinessMap.value.get(chart.order) ?? FALLBACK_READINESS
}

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${combo.value?.layoutColumns ?? 1}, minmax(0, 1fr))`,
}))

const reviewItems = computed(() => {
  const current = combo.value
  if (!current) {
    return []
  }
  const layout = listRows('dashboardboard').find(
    (row) => String(row['布局编号'] ?? '') === current.layoutId,
  )
  const items = [
    {
      name: '看板名称',
      snapshot: current.dashboardName,
      current: layout ? String(layout['看板名称'] ?? '') : '看板已删除',
      same: layout ? String(layout['看板名称'] ?? '') === current.dashboardName : false,
    },
    {
      name: '包含图表组',
      snapshot: current.chartGroupRaw,
      current: layout ? String(layout['包含图表组'] ?? '') : '—',
      same: layout ? String(layout['包含图表组'] ?? '') === current.chartGroupRaw : false,
    },
    {
      name: '布局列数',
      snapshot: String(current.layoutColumns),
      current: layout ? String(layout['布局列数'] ?? '') : '—',
      same: layout ? String(layout['布局列数'] ?? '') === String(current.layoutColumns) : false,
    },
    {
      name: '自动刷新秒',
      snapshot: String(current.refreshSeconds),
      current: layout ? String(layout['自动刷新秒'] ?? '') : '—',
      same: layout ? String(layout['自动刷新秒'] ?? '') === String(current.refreshSeconds) : false,
    },
    {
      name: '全屏模式',
      snapshot: current.fullscreen ? '是' : '否',
      current: layout ? String(layout['全屏模式'] ?? '') : '—',
      same: layout ? String(layout['全屏模式'] ?? '') === (current.fullscreen ? '是' : '否') : false,
    },
    {
      name: '来源配置',
      snapshot: `布局 ${current.source.layoutId} · 生成时状态「${current.source.layoutStatus}」`,
      current: layout ? `当前状态「${String(layout.status ?? '')}」` : '看板已删除，快照保留来源记录',
      same: Boolean(layout),
    },
  ]
  return items
})

function barsOf(chart: ComboChartItem): number[] {
  let hash = 0
  for (const char of chart.configId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  return Array.from({ length: 8 }, (_, index) => 20 + ((hash >> (index * 3)) % 70))
}

function nowText(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

onMounted(() => {
  registerShareVisit(comboId)
  lastRefresh.value = nowText()
  const seconds = combo.value?.refreshSeconds ?? 0
  if (seconds > 0) {
    countdown.value = seconds
    timer = window.setInterval(() => {
      countdown.value -= 1
      if (countdown.value <= 0) {
        tick.value += 1
        lastRefresh.value = nowText()
        countdown.value = seconds
      }
    }, 1000)
  }
})

onUnmounted(() => {
  if (timer !== undefined) {
    window.clearInterval(timer)
  }
})
</script>
