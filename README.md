# mini-react

一个**用于学习 React 18 实现原理**的最小可运行实现。

用约 600 行、零运行时依赖的代码，复刻 React 现代架构的核心：
**虚拟 DOM → Fiber → 可中断渲染（并发）→ diff 协调 → commit → Hooks**。

---

## 快速开始

```bash
npm install
npm run dev      # 启动示例，浏览器打开 http://localhost:5173
npm run test     # 在 jsdom 中跑核心逻辑的冒烟测试
npm run build    # 生产构建
```

示例 `src/App.jsx` 演示了：`useState` 计数器、`useEffect`+`useRef` 计时器、
基于 `key` 的列表协调（增删/重排）、`useReducer`+`useMemo`、条件渲染与 `Fragment`。

---

## 它实现了什么

| 能力 | 文件 | 说明 |
| --- | --- | --- |
| JSX / 虚拟 DOM | `createElement.js` | JSX 编译为 `createElement` 调用，产出 React Element |
| DOM 渲染与属性 diff | `dom.js` | 创建节点、最小化更新属性、绑定/解绑事件 |
| Fiber + 可中断渲染 | `reconciler.js` | Fiber 链表树、work loop、双缓存、协调(diff) |
| 调度器（时间切片） | `scheduler.js` | 用 `MessageChannel` 模拟 `requestIdleCallback` |
| commit 阶段 | `commit.js` | Placement / Update / Deletion，effect 执行 |
| Hooks | `hooks.js` | `useState / useReducer / useEffect / useRef / useMemo / useCallback` |

---

## 核心原理

### 1. JSX → 虚拟 DOM

`<div id="a">hi</div>` 经构建工具编译为
`MiniReact.createElement("div", { id: "a" }, "hi")`，
产出一个普通对象（React Element）：

```js
{ type: "div", key: null, props: { id: "a", children: [ /* 文本节点 */ ] } }
```

文本会被包装成 `TEXT_ELEMENT`，让后续协调对所有节点一视同仁。
（本项目通过 `vite.config.js` 的 `jsxFactory` 把 JSX 指向我们自己的实现。）

### 2. Fiber 架构

每个 Element 在渲染时会对应一个 **Fiber**——它既是 DOM 的描述，也是一个
**工作单元 (unit of work)**。Fiber 用链表把树「展开」：

```
        child            child
  root ───────▶ App ───────▶ div
                              │ child
                              ▼
                            span ──sibling──▶ ul
                                               │ child
                                               ▼
                                              li ──sibling──▶ li
```

`child / sibling / parent` 三个指针让我们可以**在任意节点中断遍历**，
之后凭一个指针 `nextUnitOfWork` 精确恢复——这是并发渲染的前提。

### 3. 可中断渲染（并发的本质）

渲染分两个阶段：

- **render / 协调阶段（可中断）**：构建 Fiber 树、做 diff、给每个 Fiber 打
  `effectTag` 标记。这个阶段被切成很多小片，每处理完一个 Fiber 就问调度器
  「这一帧还有时间吗？」，没时间就 `return` 让浏览器先去渲染/响应输入，
  下一帧再继续。**此阶段不碰真实 DOM**，所以中断不会让用户看到中间态。
- **commit 阶段（不可中断）**：一次性把所有标记同步到真实 DOM。

```js
function workLoop(deadline) {
  while (nextUnitOfWork && deadline.timeRemaining() > 1) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
  }
  if (!nextUnitOfWork && wipRoot) commitRoot(wipRoot, deletions); // 全部完成才提交
  ...
}
```

> 调度器没有用 `requestIdleCallback`（兼容性/触发时机不稳定），而是和真实 React 一样
> 用 `MessageChannel` 自己实现宏任务调度，见 `scheduler.js`。

### 4. 双缓存（current / wip 树）

屏幕上的树叫 **current**，正在构建的叫 **work-in-progress (wip)**。
两棵树的同位节点通过 `alternate` 互相指向、复用对象。
wip 构建完毕后整体「转正」为 current——一次性切换，避免 UI 撕裂。

### 5. diff 协调与 `key`

`reconcileChildren` 对比「旧 Fiber」与「新 Element 列表」：

- 通过 **`key`** 建立新旧节点的身份对应（缺省用下标兜底）。
- 类型相同 → 复用 DOM，标记 `UPDATE`，只更新变化的 props。
- 没有匹配 → 标记 `PLACEMENT`（新建并插入）。
- 旧的没被复用 → 标记 `DELETION`（卸载，并执行 effect 清理）。
- 复用但相对位置变化 → 借助 `lastPlacedIndex` 判定「移动」，commit 时用
  `insertBefore` 重新放置（这正是 React 处理列表重排的核心技巧）。

### 6. commit 阶段

遍历打了标记的 wip 树，按 `effectTag` 落实到真实 DOM：

- `PLACEMENT`：`insertBefore` 到正确位置（含「移动」已存在节点）。
- `UPDATE`：对比新旧 props 增量更新。
- `DELETION`：从 DOM 移除，并运行子树内所有 `useEffect` 的清理函数。

### 7. Hooks 的秘密

Hooks 状态就挂在**函数组件对应的 Fiber 上的一个数组**里。
渲染时按**调用顺序 + 下标**与上一次渲染的 hook 一一对应——
这就是「**Hooks 不能写在条件/循环里**」的根本原因。

- `useState` 是 `useReducer` 的语法糖；`setState` 把 action 推入队列并触发重渲染，
  多次调用被调度器合并（批量更新），下一次渲染时重新计算 state。
- `useEffect` 对比依赖数组决定是否执行；返回的清理函数会在「依赖变化前」或「卸载时」运行。
- `useRef` 跨渲染复用同一个 `{ current }` 容器，修改它不触发重渲染。
- `useMemo` / `useCallback` 依赖不变时复用上一次的结果。

---

## 与真实 React 的差异（刻意简化）

为突出主干、便于阅读，以下做了简化：

- 每次更新都从根节点重新协调（真实 React 从触发更新的组件子树开始，并有优先级 lanes）。
- `useEffect` 在 commit 末尾**同步**执行（真实 React 在浏览器绘制后异步执行）。
- 没有合成事件系统（直接用原生 `addEventListener`）、没有 `Context`、`Suspense`、
  错误边界、`memo`、Portal、SSR 等。
- diff 是单层 key 匹配 + `lastPlacedIndex` 移动判定；移动主要在「宿主元素」层面生效。

这些都不影响理解 React 的**核心数据流与架构思想**。

---

## 目录结构

```
src/
├── mini-react/
│   ├── index.js          # 对外入口（createRoot / hooks / createElement）
│   ├── createElement.js  # JSX -> 虚拟 DOM、Fragment、文本节点
│   ├── dom.js            # 真实 DOM 创建与属性/事件 diff
│   ├── reconciler.js     # Fiber、work loop、双缓存、协调(diff)
│   ├── commit.js         # commit 阶段、effect 执行
│   ├── hooks.js          # 全部 hooks 实现
│   └── scheduler.js      # 基于 MessageChannel 的时间切片调度
├── App.jsx               # 示例
├── main.jsx              # 入口：createRoot(...).render(<App/>)
└── styles.css
```

建议阅读顺序：`createElement.js` → `reconciler.js` → `commit.js` → `hooks.js` → `scheduler.js`。

## License

MIT
