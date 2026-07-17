# Joi「今日」页面与会话分支 UI 验收合同

## Scope

- Project: Joi Desktop
- Target screen: 安装版 `/Applications/Joi.app` 的会话侧栏、中央工作区和右侧检查器
- Files likely to change: `apps/joi-desktop/frontend/src/App.tsx`、`apps/joi-desktop/frontend/src/styles.css`、相关前端合同测试
- User job: 随时进入跨会话的今日待处理事项；理解并使用当前会话的分支，而不把它误认为全部历史会话

## Reference

- Primary reference: 当前 Joi 安装版现有视觉语言与布局
- What to copy: 现有侧栏密度、颜色、圆角、字号、按钮和右侧检查器结构
- What not to copy: Today 模态遮罩、重复的顶栏 Today 按钮、把高级维护操作直接铺在分支主操作下

## Information Structure

- Must keep: 渠道和线程列表、Today 的全部现有数据与操作、会话分支数据与能力、右侧检查器其余 Tab
- Must remove: Today 模态弹窗；聊天顶栏 Today 入口；用户可见的「会话树」命名
- Must not add: 新数据源、新视觉主题、与 Today 或分支无关的模块

## Visual Rules

- Layout density: 保持当前紧凑桌面密度
- Spacing/type/color/borders: 复用当前 token 和组件，不引入新的视觉风格
- Today: 左侧固定条目位于会话标题下、可滚动列表上方；中央为独立页面，不显示聊天输入框或遮罩
- Branches: 保留右侧 Tab；主要区域只显示分支关系和新建分支，高级操作默认折叠

## Interaction Rules

- 点击左侧「今日」后中央切换到独立页，并刷新 Today 数据
- 点击渠道或线程后回到聊天页；Today 不表现为一个会话
- Today 徽标只统计可见待看事项；`quiet` 与已有统计卡覆盖的 `*_total` 汇总项不重复进入列表；0 也应有清楚的安静状态
- Today 中打开任务、运行、产物和恢复任务的原有动作继续有效
- 「分支」只展示当前会话家族；单节点时说明当前尚无分支
- 分支主操作文案为「从这里新开分支」；上下文压缩与导入导出置于「高级」折叠区
- 键盘焦点、hover、active、disabled 状态沿用现有组件约定

## Verification

- Browser target: `/Applications/Joi.app`（Computer Use）
- Viewport: 当前标准 macOS 桌面窗口；移动端不适用
- Required screenshots: 左侧「今日」固定入口与 Today 独立页；右侧「分支」单节点状态；「高级」展开状态
- Required DOM/AX checks: 「今日」为按钮且具有当前页状态；中央页面不是 dialog；右侧 Tab 名为「分支」；无聊天顶栏 Today 按钮
- Commands: 前端合同测试、前端构建、Electron 打包、codesign 校验

## Done Means

- [x] 信息结构与以上合同一致
- [x] 未新增无关功能或视觉样式
- [x] 前端合同测试与构建通过
- [x] 新安装包替换并运行于 `/Applications/Joi.app`
- [x] 安装版可见 UI 与 AX 证据已保存
- [x] 用户数据目录未删除或重建
