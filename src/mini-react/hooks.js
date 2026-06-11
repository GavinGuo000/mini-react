/**
 * Hooks —— 函数组件的状态与副作用
 *
 * 【核心思想】
 *   Hooks 的本质是“将状态与副作用逻辑附加到函数组件上”，
 *   而函数组件本身是无状态的纯函数（接收 props，返回 Element）。
 *
 * 【实现关键】
 *   1. 每个函数组件 Fiber 上挂一个 hooks 数组，记录该组件所有的 hook 状态
 *   2. Hooks 靠「调用顺序 + 下标」与上一次渲染的 hook 一一对应
 *      ——这就是为什么 React 规定 hooks 不能写在条件/循环里！
 *      如果调用顺序改变了，下标对应就会错乱，导致状态混乱。
 *   3. setState 把 action 推进队列并触发一次重渲染；
 *      下一次渲染时按队列重新计算 state，实现「批量更新」。
 *
 * 【Hook 对象结构】
 *   每个 hook 在 hooks 数组中占据一个位置，通过 tag 区分类型：
 *   - { tag: "state",  state, queue }         // useReducer / useState
 *   - { tag: "effect", effect, deps, cleanup, hasChanged }  // useEffect
 *   - { tag: "ref",    current }               // useRef
 *   - { tag: "memo",   value, deps }           // useMemo / useCallback
 */

import { scheduleUpdate } from "./reconciler.js";

// ============================================================================
// 模块级状态：用于在渲染过程中跟踪当前正在执行哪个组件、第几个 hook
// ============================================================================

/** 当前正在渲染的函数组件 Fiber（每次执行组件函数前由协调器设置） */
let wipFiber = null;

/** 当前 hook 在该组件 Fiber 的 hooks 数组中的下标（每次执行组件函数前重置为 0） */
let hookIndex = 0;

/**
 * 准备执行 Hooks —— 在协调器执行组件函数之前调用。
 *
 * 【调用时机】
 *   reconciler.js 中的 updateFunctionComponent() 在调用组件函数前会调用本函数。
 *
 * 【做了什么】
 *   1. 记录当前正在渲染的 Fiber，供各个 hook 函数访问
 *   2. 初始化 hooks 数组（每次渲染都重新构建）
 *   3. 重置 hookIndex 为 0，从第一个 hook 开始计数
 *
 * 【为什么每次渲染都重置 hooks 数组？】
 *   因为 hooks 状态实际上是从上一次渲染的 alternate Fiber 中继承过来的，
 *   新的 hooks 数组会在各个 hook 函数中通过 getOldHook() 拿到旧值并复制。
 *
 * @param {object} fiber - 当前正在渲染的函数组件 Fiber 节点
 */
export function prepareToUseHooks(fiber) {
  wipFiber = fiber;
  wipFiber.hooks = [];
  hookIndex = 0;
}

/**
 * 获取上一次渲染中对应位置的 hook 对象。
 *
 * 【工作原理】
 *   通过 wipFiber.alternate 找到上一次渲染的同一个组件 Fiber，
 *   然后通过当前的 hookIndex 下标拿到对应的旧 hook 对象。
 *
 * 【为什么能用下标对应？】
 *   因为 React 规定 hooks 必须在组件顶层调用（不能在条件/循环中），
 *   所以同一个组件每次渲染时 hooks 的调用顺序是固定的，
 *   下标 i 总是对应同一个 hook。
 *
 * @returns {object|undefined} 上一次渲染的 hook 对象，首次渲染时返回 undefined
 */
function getOldHook() {
  return wipFiber.alternate && wipFiber.alternate.hooks
    ? wipFiber.alternate.hooks[hookIndex]
    : undefined;
}

/**
 * useReducer —— 所有状态类 hook 的基础。
 *
 * 【设计思想】
 *   useReducer 是 React 中状态管理的底层原语，
 *   useState 本质上就是 useReducer 的特化版。
 *   它采用“reducer 模式”：通过 dispatch(action) 发送意图，
 *   reducer 函数根据当前 state 和 action 计算出新 state。
 *
 * 【工作流程】
 *   1. 获取上一次渲染的 hook 对象（oldHook）
 *   2. 构建新的 hook 对象，继承旧的 state 和待处理的 action 队列
 *   3. 把队列中所有的 action 依次应用到 reducer，得到最新 state
 *   4. 返回当前 state 和 dispatch 函数
 *
 * 【批量更新机制】
 *   如果在同一轮事件中多次调用 dispatch（如 onClick 中连续调用），
 *   多个 action 会被推入 queue 队列。
 *   下一次渲染时，这个函数会把队列中的 action 依次应用，
 *   而不是每个 dispatch 都触发一次独立的重渲染。
 *
 * @param {function} reducer - 状态更新函数：(state, action) => newState
 * @param {*} initialArg - 初始状态值
 * @param {function} [init] - 惰性初始化函数：(initialArg) => initialState（可选）
 * @returns {[*, function]} [当前 state, dispatch 函数]
 */
export function useReducer(reducer, initialArg, init) {
  // 获取上一次渲染中对应位置的 hook 对象
  const oldHook = getOldHook();

  // 构建新的 hook 对象：
  // - 首次渲染：state = init(initialArg) 或 initialArg，queue 为空
  // - 后续渲染：继承上一次的 state 和待处理的 action 队列
  const hook = {
    tag: "state",
    state: oldHook ? oldHook.state : init ? init(initialArg) : initialArg,
    queue: oldHook ? oldHook.queue : [],
  };

  // 【批量更新】把上一轮排队的所有 action 依次应用到 reducer，
  // 得到本轮最新 state。这就是为什么多次 setState 会被合并。
  const pending = hook.queue;
  hook.queue = []; // 清空队列，为下一轮做准备
  pending.forEach((action) => {
    hook.state = reducer(hook.state, action);
  });

  // dispatch 函数：将 action 推入队列，并触发一次重渲染。
  // 注意：多次 dispatch 调用会被调度器合并为一次重渲染（通过 ensureWorkLoop 去重）
  const dispatch = (action) => {
    hook.queue.push(action);
    scheduleUpdate();
  };

  // 将新 hook 存入当前 Fiber 的 hooks 数组，并递增下标
  wipFiber.hooks[hookIndex] = hook;
  hookIndex++;

  return [hook.state, dispatch];
}

/**
 * useState —— useReducer 的语法糖，最常用的状态管理 hook。
 *
 * 【与 useReducer 的关系】
 *   useState 内部直接调用 useReducer，只是提供了一个更简洁的 API：
 *   - reducer 变成了简单的“替换或函数更新”逻辑
 *   - 支持函数式更新：setState(prev => prev + 1)
 *   - 支持惰性初始化：useState(() => expensiveComputation())
 *
 * 【函数式更新】
 *   setState 可以接收一个函数，该函数接收当前 state 并返回新 state：
 *     setCount(c => c + 1)   // action 是函数，会被调用并传入当前 state
 *     setName("Alice")       // action 是值，直接替换
 *
 * 【惰性初始化】
 *   如果 initialState 是一个函数，只在首次渲染时执行（性能优化）。
 *   后续渲染时不会重复执行，因为 state 已经从 oldHook 继承了。
 *
 * @param {*} initialState - 初始状态值，或返回初始值的函数
 * @returns {[*, function]} [当前 state, setState 函数]
 */
export function useState(initialState) {
  // 内置的 reducer：如果 action 是函数就调用它（函数式更新），否则直接替换
  const stateReducer = (state, action) =>
    typeof action === "function" ? action(state) : action;

  // 惰性初始化包装：只在首次渲染时执行（因为 init 函数只在 oldHook 不存在时被调用）
  const lazyInit = () =>
    typeof initialState === "function" ? initialState() : initialState;

  // 委托给 useReducer，initialArg 传 undefined（因为初始化逻辑已经封装在 lazyInit 中）
  return useReducer(stateReducer, undefined, lazyInit);
}

/**
 * useEffect —— 在渲染完成后执行副作用操作。
 *
 * 【执行时机】
 *   在 commit 阶段的末尾执行（commit.js 中的 runEffects）。
 *   如果依赖数组中的值发生了变化，先运行上一次的 cleanup 函数，
 *   再运行本次的 effect 函数。
 *
 * 【依赖数组规则】
 *   - 不传 deps（undefined）：每次渲染后都执行
 *   - 传空数组 []：只在挂载时执行一次（类似 componentDidMount）
 *   - 传 [a, b]：当 a 或 b 变化时执行
 *
 * 【清理函数】
 *   effect 函数可以返回一个清理函数（cleanup），
 *   它会在下次执行同一个 effect 前、或者组件卸载时被调用。
 *   典型场景：取消订阅、清除定时器、解绑事件等。
 *
 * 【与 React 的区别】
 *   真实 React 的 useEffect 是在浏览器绘制之后异步执行的，
 *   这里为了简化，在 commit 末尾同步执行。
 *
 * @param {function} effect - 副作用函数，可以返回一个清理函数
 * @param {Array} [deps] - 依赖数组（可选）
 */
export function useEffect(effect, deps) {
  const oldHook = getOldHook();

  // 判断依赖是否发生变化：
  // - 首次渲染（没有 oldHook）：hasChanged = true，必须执行
  // - 后续渲染：通过浅比较新旧 deps 判断
  const hasChanged = oldHook ? !depsEqual(oldHook.deps, deps) : true;

  // 将 effect hook 存入 hooks 数组：
  // - cleanup：从上一次渲染的 hook 中继承清理函数，
  //   它会在 commit 阶段被调用（先清理旧的，再执行新的）
  // - hasChanged：标记本次是否需要执行 effect，commit 阶段会检查此标记
  wipFiber.hooks[hookIndex] = {
    tag: "effect",
    effect,
    deps,
    cleanup: oldHook ? oldHook.cleanup : undefined,
    hasChanged,
  };
  hookIndex++;
}

/**
 * useRef —— 跨渲染周期保持同一个可变引用容器。
 *
 * 【核心特性】
 *   1. 返回一个 { current: initialValue } 的对象
 *   2. 修改 ref.current 不会触发重渲染（与 useState 的关键区别）
 *   3. 在整个组件生命周期内保持同一个对象引用
 *
 * 【常见用途】
 *   - 保存定时器 ID（setInterval 返回的 ID，用于 cleanup）
 *   - 保存上一次渲染的状态值（用于对比）
 *   - 记录渲染次数（每次渲染 ref.current += 1）
 *   - 在真实 React 中还可以用于访问 DOM 节点
 *
 * 【实现原理】
 *   首次渲染时创建 hook 对象，后续渲染时直接复用同一个对象（oldHook），
 *   因此 ref.current 的修改会被保留。
 *
 * @param {*} initialValue - ref.current 的初始值
 * @returns {{ current: * }} 可变的引用容器对象
 */
export function useRef(initialValue) {
  const oldHook = getOldHook();

  // 首次渲染创建新对象，后续渲染直接复用旧对象（保持引用稳定）
  const hook = oldHook || { tag: "ref", current: initialValue };

  wipFiber.hooks[hookIndex] = hook;
  hookIndex++;
  return hook;
}

/**
 * useMemo —— 依赖不变时复用上一次的计算结果，避免重复计算。
 *
 * 【工作原理】
 *   1. 首次渲染：执行 factory() 计算值并缓存
 *   2. 后续渲染：对比依赖数组，如果不变就直接返回缓存值，否则重新计算
 *
 * 【使用场景】
 *   - 昂贵的计算操作（如阶乘、大数组过滤/排序等）
 *   - 保持对象引用稳定（避免子组件不必要的重渲染）
 *
 * 【注意】
 *   useMemo 是性能优化手段，不是语义保证。
 *   React 可能在将来选择性地“忘记”之前缓存的值（例如内存压力大时）。
 *
 * @param {function} factory - 计算函数，返回需要缓存的值
 * @param {Array} deps - 依赖数组
 * @returns {*} 缓存的计算结果
 */
export function useMemo(factory, deps) {
  const oldHook = getOldHook();

  // 判断是否可以复用上一次的缓存值：
  // - 必须有旧 hook 且依赖数组相等
  const canReuse = oldHook && depsEqual(oldHook.deps, deps);

  // 可以复用则直接取旧值，否则重新执行 factory 计算
  const value = canReuse ? oldHook.value : factory();

  wipFiber.hooks[hookIndex] = { tag: "memo", value, deps };
  hookIndex++;
  return value;
}

/**
 * useCallback —— useMemo 的特化版，专门用于缓存函数引用。
 *
 * 【与 useMemo 的关系】
 *   useCallback(fn, deps) 等价于 useMemo(() => fn, deps)
 *   只是语义上更明确：目的是缓存函数本身，而不是函数的返回值。
 *
 * 【使用场景】
 *   当把回调函数作为 props 传给子组件时，
 *   如果每次都创建新函数，子组件会认为 props 变了而重渲染。
 *   useCallback 保证在依赖不变时返回同一个函数引用。
 *
 * @param {function} callback - 需要缓存的回调函数
 * @param {Array} deps - 依赖数组
 * @returns {function} 缓存的函数引用
 */
export function useCallback(callback, deps) {
  return useMemo(() => callback, deps);
}

/**
 * 依赖数组浅比较 —— 判断两次渲染的依赖是否相同。
 *
 * 【比较规则】
 *   1. 任一依赖为 undefined（未传入） -> 返回 false -> 每次都执行
 *   2. 长度不同 -> 返回 false
 *   3. 逐个元素用 Object.is() 比较（能正确处理 NaN、+0/-0）
 *
 * 【为什么用浅比较而不是深比较？】
 *   React 的依赖数组设计约定就是浅比较，因为：
 *   - 深比较性能开销大，可能抵消 useMemo/useEffect 的优化效果
 *   - 浅比较足够覆盖绝大多数场景（基本类型 + 稳定引用）
 *
 * @param {Array} a - 上一次渲染的依赖数组
 * @param {Array} b - 本次渲染的依赖数组
 * @returns {boolean} true 表示相等（可跳过执行），false 表示不相等（需重新执行）
 */
function depsEqual(a, b) {
  // 任一依赖数组不存在（undefined）时，认为不相等 -> 每次都执行
  if (!a || !b) return false;
  // 长度不同，一定不相等
  if (a.length !== b.length) return false;
  // 用 Object.is 逐个比较，能正确处理 NaN === NaN 和 +0 !== -0
  return a.every((item, i) => Object.is(item, b[i]));
}
