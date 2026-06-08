import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useReducer,
} from "/src/mini-react/index.js";

// 1) useState —— 最基础的状态
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

// 2) useEffect + useRef —— 副作用与跨渲染引用
function Timer() {
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(true);
  const renderCount = useRef(0);
  renderCount.current += 1;

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

// 3) key diff —— 增删 / 反转列表时复用节点、保留状态
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

// 4) useReducer + useMemo —— 复杂状态与计算缓存
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

// 5) 条件渲染 + Fragment
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
