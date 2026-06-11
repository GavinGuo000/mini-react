/**
 * createElement —— JSX 的运行时入口，负责把 JSX 转成「虚拟 DOM」(React Element)
 *
 * 【转换流程】
 *   JSX:        <div id="a">hello{name}</div>
 *   编译后:     MiniReact.createElement("div", { id: "a" }, "hello", name)
 *   产物(Element): { type: "div", props: { id: "a", children: [ ... ] } }
 *
 * 【为什么要转成 Element？】
 *   Element 是一个轻量级的纯 JS 对象，它描述了「界面上应该有什么」。
 *   后续的 Fiber 协调器会拿 Element 树与上一次的 Fiber 树做 diff，
 *   从而计算出最小的 DOM 操作集合。
 *
 * 【与 React 的区别】
 *   React 17+ 引入了新的 JSX Transform（jsx/jsxs），不再需要手动 import React。
 *   这里我们沿用经典的 createElement 方式，由 Vite 的 jsxFactory 配置指定。
 */

/**
 * 文本节点的类型标识常量。
 *
 * 在 React 内部，文本内容（字符串/数字）也需要被当作 Element 来处理，
 * 这样 Fiber 协调器就能用统一的逻辑处理所有节点类型。
 * 例如："hello" 会被包装成 { type: "TEXT_ELEMENT", props: { nodeValue: "hello", children: [] } }
 */
export const TEXT_ELEMENT = "TEXT_ELEMENT";

/**
 * Fragment（片段）标识符，对应 JSX 中的 <>...</> 语法。
 *
 * 【作用】
 *   当组件需要返回多个并列元素但又不想额外包一层 div 时，
 *   可以使用 Fragment。它不会产生真实 DOM 节点，
 *   在协调阶段会被特殊处理——只渲染其子节点。
 *
 * 【为什么用 Symbol？】
 *   Symbol 保证全局唯一，不会与任何字符串类型的 HTML 标签名冲突。
 *   React 源码中也是用 Symbol 来标识 Fragment 的。
 */
export const Fragment = Symbol.for("mini-react.fragment");

/**
 * 将原始值（字符串/数字）包装成标准的 Element 结构。
 *
 * 【为什么需要包装？】
 *   Fiber 协调器在处理子节点时，期望每个 child 都是一个 Element 对象。
 *   但 JSX 中的文本内容（如 "hello"）是原始类型，不是对象。
 *   通过统一包装，协调器就能用同一套逻辑处理文本节点和元素节点。
 *
 * 【产物结构】
 *   createTextElement("hello") => {
 *     type: "TEXT_ELEMENT",
 *     props: { nodeValue: "hello", children: [] }
 *   }
 *   后续 DOM 层会根据 TEXT_ELEMENT 类型创建 TextNode。
 *
 * @param {string|number} text - 需要包装的文本内容
 * @returns {object} 标准化的虚拟 DOM Element
 */
function createTextElement(text) {
  return {
    type: TEXT_ELEMENT,
    props: {
      nodeValue: text,
      children: [],
    },
  };
}

/**
 * 判断一个子节点是否应该被渲染。
 *
 * 【为什么需要过滤？】
 *   在 JSX 中，条件渲染的常见写法会产生 false/null/undefined/true 值：
 *     {isLoggedIn && <Dashboard />}    => isLoggedIn 为 false 时结果为 false
 *     {isAdmin ? <Admin /> : null}     => 非管理员时结果为 null
 *   这些值不应该生成任何 DOM 节点，需要在构建 Element 时过滤掉。
 *
 * @param {*} child - 待检查的子节点
 * @returns {boolean} true 表示该子节点应该被保留并渲染
 */
function isRenderable(child) {
  return child !== false && child !== null && child !== undefined && child !== true;
}

/**
 * createElement —— JSX 编译后的运行时入口函数。
 *
 * 【调用示例】
 *   JSX:     <div id="box" key="a">hello<span>{name}</span></div>
 *   编译为:  createElement("div", { id: "box", key: "a" }, "hello", createElement("span", null, name))
 *
 * 【参数说明】
 *   @param {string|function|Symbol} type - 节点类型：
 *     - 字符串（"div"/"span" 等）: 宿主组件，对应真实 DOM 标签
 *     - 函数组件: 用户定义的组件函数，执行后返回 Element
 *     - Symbol(Fragment): 片段，不产生 DOM
 *   @param {object|null} props - JSX 中传递的所有属性（包括 key、ref）
 *   @param {...*} children - 所有子节点（可能是 Element、字符串、数字、数组等）
 *   @returns {object} 虚拟 DOM Element 对象
 *
 * 【key 和 ref 的特殊处理】
 *   key 用于列表 diff 时标识节点身份，ref 用于获取 DOM 引用，
 *   它们不属于普通 props，需要从 props 中提取出来放到 Element 的顶层。
 */
export function createElement(type, props, ...children) {
  // 从 props 中分离出 key 和 ref，剩余的才是真正的组件属性
  const { key = null, ref = null, ...restProps } = props || {};

  // 【children 规范化流程】
  // 1. flat(Infinity) — 拍平嵌套数组。例如 list.map() 返回的数组会变成扁平结构
  // 2. filter(isRenderable) — 过滤掉 false/null/undefined/true（条件渲染的产物）
  // 3. map — 将原始类型（字符串/数字）包装为 TextElement，对象类型保持不变
  const normalizedChildren = children
    .flat(Infinity)
    .filter(isRenderable)
    .map((child) =>
      typeof child === "object" ? child : createTextElement(child)
    );

  // 返回标准的 Element 对象，这就是「虚拟 DOM」的一个节点
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
