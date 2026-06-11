/**
 * App.jsx —— mini-react 演示应用的根组件
 *
 * 本文件包含多个演示组件，每个组件展示了 mini-react 的一个核心特性：
 *   1. Counter    — useState 基础状态管理
 *   2. Timer      — useEffect 副作用 + useRef 跨渲染引用
 *   3. KeyedList  — key diff 列表协调
 *   4. ReducerMemo — useReducer 复杂状态 + useMemo 计算缓存
 *   5. Toggle     — 条件渲染 + Fragment
 */

// 从 mini-react 中导入所有演示所需的 hooks
import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useReducer,
} from "/src/mini-react/index.js";

/**
 * Counter 组件 —— 演示 useState 基础状态管理。
 *
 * 【演示要点】
 *   - useState 创建状态值和更新函数
 *   - 函数式更新：setCount(c => c + 1)，基于当前值计算新值
 *   - 直接设置值：setCount(0) 重置
 */
function Counter() {
  const [count, setCount] = useState(0);
  return (
    <div className="card">
      <h2>useState · 计数器</h2>
      <p className="hint">
        点击按钮触发 <code>setState</code>，调度器会重新构建 Fiber 树并 diff 更新。
      </p>
      <div className="row">
        <button onClick={() => setCount((c) => c - 1)}>－</button>
        <span className="count">{count}</span>
        <button onClick={() => setCount((c) => c + 1)}>＋</button>
        <button onClick={() => setCount(0)}>重置</button>
      </div>
    </div>
  );
}

/**
 * Timer 组件 —— 演示 useEffect + useRef。
 *
 * 【演示要点】
 *   - useEffect：创建定时器（副作用），返回清理函数（清除定时器）
 *   - 依赖数组 [running]：只在 running 变化时重新创建/清除定时器
 *   - useRef：跨渲染周期保存渲染次数，修改 ref.current 不触发重渲染
 */
function Timer() {
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(true);
  // useRef 创建一个跨渲染的可变容器，用于记录组件被渲染的次数
  // 每次渲染都 +1，但不会触发额外的重渲染
  const renderCount = useRef(0);
  renderCount.current += 1;

  // useEffect：根据 running 状态创建或清除定时器
  // 依赖数组 [running]：只有 running 变化时才重新执行
  // 清理函数 return () => clearInterval(id)：在 running 变化或组件卸载时执行
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    // 返回清理函数：依赖变化或卸载时执行，避免重复定时器。
    return () => clearInterval(id);
  }, [running]);

  return (
    <div className="card">
      <h2>useEffect + useRef · 计时器</h2>
      <p className="hint">
        <code>useEffect</code> 的清理函数在依赖变化时先清理旧定时器；
        <code>useRef</code> 跨渲染保存渲染次数而不触发重渲染。
      </p>
      <div className="row">
        <span className="timer">{seconds}s</span>
        <button className="primary" onClick={() => setRunning((r) => !r)}>
          {running ? "暂停" : "继续"}
        </button>
        <button onClick={() => setSeconds(0)}>清零</button>
        <span className="badge">本组件已渲染 {renderCount.current} 次</span>
      </div>
    </div>
  );
}

/**
 * KeyedList 组件 —— 演示 key diff 算法与列表协调。
 *
 * 【演示要点】
 *   - key 的作用：通过 key 建立新旧节点的身份对应关系
 *   - 增删操作：新增/删除时，只有对应节点被标记 PLACEMENT/DELETION
 *   - 随机排序：节点位置变化时，通过 lastPlacedIndex 检测移动
 *   - 复用 DOM：key 相同的节点会复用已有的 DOM 和状态
 */
/** 全局自增 ID 生成器，用于给新增的列表项分配唯一 key */
let uid = 3;
function KeyedList() {
  const [items, setItems] = useState([
    { id: 1, text: "学习 Fiber 架构" },
    { id: 2, text: "理解 key 的作用" },
    { id: 3, text: "手写 hooks" },
  ]);
  const [text, setText] = useState("");

  const add = () => {
    if (!text.trim()) return;
    setItems((list) => [...list, { id: ++uid, text }]);
    setText("");
  };
  const remove = (id) => setItems((list) => list.filter((i) => i.id !== id));
  const shuffle = () =>
    setItems((list) => [...list].sort(() => Math.random() - 0.5));

  return (
    <div className="card">
      <h2>key diff · 列表协调</h2>
      <p className="hint">
        带 <code>key</code> 的协调能在增删、反转时按身份复用 Fiber/DOM。
      </p>
      <div className="row">
        <input
          value={text}
          placeholder="输入待办，回车添加"
          onInput={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="primary" onClick={add}>
          添加
        </button>
        <button onClick={shuffle}>随机排序</button>
      </div>
      <ul className="list">
        {items.map((item) => (
          <li key={item.id}>
            <span>
              {item.text}
              <span className="key">key={item.id}</span>
            </span>
            <button className="danger" onClick={() => remove(item.id)}>
              删除
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * ReducerMemo 组件 —— 演示 useReducer + useMemo。
 *
 * 【演示要点】
 *   - useReducer：通过 dispatch(action) 发送意图，reducer 函数计算新状态
 *   - useMemo：缓存昂贵的阶乘计算结果，只在 n 变化时才重新计算
 */
function ReducerMemo() {
  const [state, dispatch] = useReducer(
    (s, action) => {
      switch (action.type) {
        case "inc":
          return { ...s, n: s.n + 1 };
        case "dec":
          return { ...s, n: s.n - 1 };
        default:
          return s;
      }
    },
    { n: 1 }
  );

  // 仅当 n 变化才重新计算阶乘（昂贵计算的缓存）。
  const factorial = useMemo(() => {
    let r = 1;
    for (let i = 2; i <= state.n; i++) r *= i;
    return r;
  }, [state.n]);

  return (
    <div className="card">
      <h2>useReducer + useMemo · 阶乘</h2>
      <p className="hint">
        <code>useReducer</code> 管理状态，<code>useMemo</code> 缓存 n! 的计算结果。
      </p>
      <div className="row">
        <button onClick={() => dispatch({ type: "dec" })}>－</button>
        <span className="count">{state.n}</span>
        <button onClick={() => dispatch({ type: "inc" })}>＋</button>
        <span className="badge">
          {state.n}! = {factorial}
        </span>
      </div>
    </div>
  );
}

/**
 * Toggle 组件 —— 演示条件渲染 + Fragment。
 *
 * 【演示要点】
 *   - 条件渲染：open 为 false 时，子树不会被渲染
 *     （在 reconciler 中会被 isRenderable 过滤掉）
 *   - Fragment：<>...</> 不会产生额外的 DOM 节点，
 *     在 Fiber 协调时直接处理其 children
 */
function Toggle() {
  const [open, setOpen] = useState(true);
  return (
    <div className="card">
      <h2>条件渲染 + Fragment</h2>
      <p className="hint">条件为假时该子树会被标记 DELETION 并卸载（含 effect 清理）。</p>
      <div className="row">
        <button onClick={() => setOpen((o) => !o)}>
          {open ? "隐藏计时器" : "显示计时器"}
        </button>
      </div>
      {open && (
        <>
          <Timer />
        </>
      )}
    </div>
  );
}

/**
 * App —— 根组件，组装所有演示组件。
 * 作为整个组件树的起点，由 main.jsx 的 createRoot().render(<App />) 渲染。
 */
export default function App() {
  return (
    <div>
      <h1 className="title">mini-react</h1>
      <p className="subtitle">
        一个用于学习 React 18 原理的最小实现：Fiber · 可中断渲染 · diff · Hooks
      </p>
      <Counter />
      <KeyedList />
      <ReducerMemo />
      <Toggle />
    </div>
  );
}
