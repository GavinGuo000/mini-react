// ============================================================================
// createElement —— JSX 的运行时入口，负责把 JSX 转成「虚拟 DOM」(React Element)
// ----------------------------------------------------------------------------
// JSX:   <div id="a">hello{name}</div>
// 编译后: MiniReact.createElement("div", { id: "a" }, "hello", name)
// 产物:   { type: "div", props: { id: "a", children: [ ... ] } }
// ============================================================================

export const TEXT_ELEMENT = "TEXT_ELEMENT";

// Fragment：用一个唯一标识表示 <>...</>，在协调阶段会被特殊处理为「只渲染子节点」。
export const Fragment = Symbol.for("mini-react.fragment");

// 文本（字符串 / 数字）不是对象，需要包装成统一的 element 结构，
// 这样 Fiber 协调时就能一视同仁地处理所有节点。
function createTextElement(text) {
  return {
    type: TEXT_ELEMENT,
    props: {
      nodeValue: text,
      children: [],
    },
  };
}

// 过滤掉 JSX 中不应渲染的值：false / null / undefined / true（条件渲染常见产物）。
function isRenderable(child) {
  return child !== false && child !== null && child !== undefined && child !== true;
}

export function createElement(type, props, ...children) {
  const { key = null, ref = null, ...restProps } = props || {};

  // children 可能是嵌套数组（例如 list.map 返回数组），先拍平再规范化。
  const normalizedChildren = children
    .flat(Infinity)
    .filter(isRenderable)
    .map((child) =>
      typeof child === "object" ? child : createTextElement(child)
    );

  return {
    type,
    key,
    ref,
    props: {
      ...restProps,
      children: normalizedChildren,
    },
  };
}
