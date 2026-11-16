<template>
  <section class="page" data-module="sharelink">
    <header class="page-head">
      <div>
        <h2>分享管理管理</h2>
        <p class="page-desc">管理分析结果和看板的分享链接，配置访问密码和有效期。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记分享链接</button>
        <button class="btn" type="button" @click="exportRows">导出分享管理清单</button>
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
              v-if="column === '链接URL' && isShareUrl(row[column])"
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
            <button class="link" type="button" @click="openChecklist(row)">核验清单</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无分享管理数据，可先登记分享链接</td>
        </tr>
      </tbody>
    </table>

    <section v-if="checklist && checklistRow" class="combo-panel">
      <h3>独立分享核验清单：{{ checklistRow['链接编号'] }}</h3>
      <p v-if="checklist.combo" class="page-desc">
        关联组合 {{ checklist.combo.comboId }}（{{ checklist.combo.versionLabel }}）· 同步看板版本：{{
          checklist.combo.layoutId
        }}
        当前分享 {{ checklist.combo.versionLabel }} · 图表组来源「{{ checklist.combo.chartGroupRaw }}」
      </p>
      <ul class="checklist">
        <li v-for="item in checklist.items" :key="item.name">
          <span class="badge" :class="item.state">{{ stateLabel(item.state) }}</span>
          <strong>{{ item.name }}</strong>
          <span>{{ item.detail }}</span>
        </li>
      </ul>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条分享管理记录</span>
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
import { buildShareChecklist, type ShareChecklistResult } from '@/api/dashboard-combo'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('sharelink')
const columns = ["链接编号", "分享内容", "链接URL", "访问密码", "有效期至", "访问次数", "下载开关", "创建时间"]
const actions = ["生成链接", "标记失效"]
const statuses = ["草稿", "已生成", "已失效"]
const stats = [{"label": "分享链接总数", "value": 0}, {"label": "有效链接数", "value": 0}, {"label": "今日访问量", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const checklist = ref<ShareChecklistResult | null>(null)
const checklistRow = ref<EntryRow | null>(null)

function isShareUrl(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('/share/view/')
}

function stateLabel(state: 'ok' | 'warn' | 'fail'): string {
  if (state === 'ok') {
    return '通过'
  }
  if (state === 'warn') {
    return '关注'
  }
  return '未通过'
}

function openChecklist(row: EntryRow) {
  errorMessage.value = ''
  const result = buildShareChecklist(Number(row.id))
  if (!result.ok) {
    checklist.value = null
    checklistRow.value = null
    errorMessage.value = result.message ?? '无法生成核验清单'
    return
  }
  checklist.value = result
  checklistRow.value = row
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '分享链接登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
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
    errorMessage.value = error instanceof Error ? error.message : '分享管理列表读取失败'
  }
}

onMounted(reload)
</script>
