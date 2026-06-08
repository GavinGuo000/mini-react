// 临时冒烟测试：在 jsdom 里跑核心逻辑，验证 render / setState / useEffect / key diff。
import { JSDOM } from "jsdom";

const dom = new JSDOM(`<!DOCTYPE html><div id="root"></div>`);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
// MessageChannel 与 performance 用 Node 内置的全局实现即可。

const {
  createElement: h,
  createRoot,
  useState,
  useEffect,
} = await import("./src/mini-react/index.js");

const tick = () => new Promise((r) => setTimeout(r, 30));

let externalSet;
let effectRuns = 0;
let cleanupRuns = 0;

function App() {
  const [count, setCount] = useState(0);
  const [items, setItems] = useState(["a", "b", "c"]);
  externalSet = { setCount, setItems };

  useEffect(() => {
    effectRuns++;
    return () => {
      cleanupRuns++;
    };
  }, [count]);

  return h(
    "div",
    null,
    h("span", { id: "count" }, String(count)),
    h(
      "ul",
      { id: "list" },
      items.map((it) => h("li", { key: it }, it))
    )
  );
}

const root = createRoot(document.getElementById("root"));
root.render(h(App));

await tick();
const countEl = () => document.getElementById("count").textContent;
const listText = () =>
  [...document.getElementById("list").children].map((c) => c.textContent).join(",");

let pass = true;
function assert(name, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) pass = false;
}

assert("初次渲染 count=0", countEl() === "0");
assert("初次渲染 list=a,b,c", listText() === "a,b,c");
assert("useEffect 首次执行一次", effectRuns === 1);

externalSet.setCount((c) => c + 1);
externalSet.setCount((c) => c + 1);
await tick();
assert("批量 setState 后 count=2", countEl() === "2");
assert("依赖变化触发 cleanup 一次", cleanupRuns === 1);
assert("依赖变化后 effect 再次执行 (共2次)", effectRuns === 2);

externalSet.setItems(["c", "a", "b", "d"]);
await tick();
assert("key diff 重排/新增 list=c,a,b,d", listText() === "c,a,b,d");

externalSet.setItems(["a"]);
await tick();
assert("key diff 删除 list=a", listText() === "a");

console.log(pass ? "\nALL PASSED ✅" : "\nSOME FAILED ❌");
process.exit(pass ? 0 : 1);
