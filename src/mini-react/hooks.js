// ============================================================================
// Hooks —— 函数组件的状态与副作用
// ----------------------------------------------------------------------------
// 实现关键：
//   * 每个函数组件 Fiber 上挂一个 hooks 数组（链表）。
//   * Hooks 靠「调用顺序 + 下标」与上一次渲染的 hook 一一对应，
//     这就是为什么 React 规定 hooks 不能写在条件/循环里。
//   * setState 把 action 推进队列并触发一次重渲染；下一次渲染时按队列重新计算 state。
// ============================================================================

import { scheduleUpdate } from "./reconciler.js";

let wipFiber = null; // 当前正在渲染的函数组件 Fiber
let hookIndex = 0; // 当前 hook 在该 Fiber 中的下标

// 协调器在执行组件函数前调用：重置 hooks 上下文。
export function prepareToUseHooks(fiber) {
  wipFiber = fiber;
  wipFiber.hooks = [];
  hookIndex = 0;
}

function getOldHook() {
  return wipFiber.alternate && wipFiber.alternate.hooks
    ? wipFiber.alternate.hooks[hookIndex]
    : undefined;
}

// ---- useReducer：所有状态类 hook 的基础 -------------------------------------
export function useReducer(reducer, initialArg, init) {
  const oldHook = getOldHook();
  const hook = {
    tag: "state",
    state: oldHook ? oldHook.state : init ? init(initialArg) : initialArg,
    queue: oldHook ? oldHook.queue : [],
  };

  // 应用上一轮排队的 action，得到本轮最新 state（实现「批量更新」）。
  const pending = hook.queue;
  hook.queue = [];
  pending.forEach((action) => {
    hook.state = reducer(hook.state, action);
  });

  const dispatch = (action) => {
    hook.queue.push(action);
    scheduleUpdate(); // 触发重渲染；多次调用会被调度器合并为一次
  };

  wipFiber.hooks[hookIndex] = hook;
  hookIndex++;
  return [hook.state, dispatch];
}

// ---- useState：useReducer 的语法糖 -----------------------------------------
export function useState(initialState) {
  const stateReducer = (state, action) =>
    typeof action === "function" ? action(state) : action;
  // 支持惰性初始化：useState(() => expensiveInit())，且只在首次渲染执行。
  const lazyInit = () =>
    typeof initialState === "function" ? initialState() : initialState;
  return useReducer(stateReducer, undefined, lazyInit);
}

// ---- useEffect：依赖变化时执行副作用，支持清理函数 --------------------------
export function useEffect(effect, deps) {
  const oldHook = getOldHook();
  const hasChanged = oldHook ? !depsEqual(oldHook.deps, deps) : true;
  wipFiber.hooks[hookIndex] = {
    tag: "effect",
    effect,
    deps,
    cleanup: oldHook ? oldHook.cleanup : undefined, // 把上一次的清理函数带到 commit 阶段执行
    hasChanged,
  };
  hookIndex++;
}

// ---- useRef：跨渲染保持同一个可变容器 --------------------------------------
export function useRef(initialValue) {
  const oldHook = getOldHook();
  const hook = oldHook || { tag: "ref", current: initialValue };
  wipFiber.hooks[hookIndex] = hook;
  hookIndex++;
  return hook;
}

// ---- useMemo：依赖不变时复用上一次的计算结果 -------------------------------
export function useMemo(factory, deps) {
  const oldHook = getOldHook();
  const canReuse = oldHook && depsEqual(oldHook.deps, deps);
  const value = canReuse ? oldHook.value : factory();
  wipFiber.hooks[hookIndex] = { tag: "memo", value, deps };
  hookIndex++;
  return value;
}

// ---- useCallback：useMemo 的特例（缓存函数本身） ---------------------------
export function useCallback(callback, deps) {
  return useMemo(() => callback, deps);
}

// 依赖数组浅比较。返回 true 表示「相等 -> 可跳过」。
// 注意：deps 为 undefined（不传依赖）时永远返回 false -> 每次都执行。
function depsEqual(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.every((item, i) => Object.is(item, b[i]));
}
