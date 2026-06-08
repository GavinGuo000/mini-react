// ============================================================================
// DOM 操作层 —— 把 Fiber 上的 props 落实到真实 DOM 上
// ----------------------------------------------------------------------------
// 这里集中处理三类 props：
//   1. 事件     onClick / onInput ...        -> addEventListener
//   2. children 由协调器单独处理，这里跳过
//   3. 普通属性 className / style / value ... -> 直接挂到 DOM 节点上
// ============================================================================

import { TEXT_ELEMENT } from "./createElement.js";

const isEvent = (key) => key.startsWith("on");
const isProperty = (key) => key !== "children" && !isEvent(key);
const isNew = (prev, next) => (key) => prev[key] !== next[key];
const isGone = (next) => (key) => !(key in next);

// onClick -> "click"
function eventType(name) {
  return name.toLowerCase().substring(2);
}

// 根据 element 类型创建真实 DOM 节点（文本节点 or 元素节点）。
export function createDom(fiber) {
  const dom =
    fiber.type === TEXT_ELEMENT
      ? document.createTextNode("")
      : document.createElement(fiber.type);

  updateDom(dom, {}, fiber.props);
  return dom;
}

// 对比新旧 props，最小化更新真实 DOM。这是「同一节点更新」时的核心逻辑。
export function updateDom(dom, prevProps, nextProps) {
  // 1. 移除已经不存在或发生变化的旧事件监听
  Object.keys(prevProps)
    .filter(isEvent)
    .filter((key) => !(key in nextProps) || isNew(prevProps, nextProps)(key))
    .forEach((name) => {
      dom.removeEventListener(eventType(name), prevProps[name]);
    });

  // 2. 删除已经不存在的旧属性
  Object.keys(prevProps)
    .filter(isProperty)
    .filter(isGone(nextProps))
    .forEach((name) => {
      setProperty(dom, name, null);
    });

  // 3. 设置新增或变化的属性
  Object.keys(nextProps)
    .filter(isProperty)
    .filter(isNew(prevProps, nextProps))
    .forEach((name) => {
      setProperty(dom, name, nextProps[name]);
    });

  // 4. 绑定新增或变化的事件监听
  Object.keys(nextProps)
    .filter(isEvent)
    .filter(isNew(prevProps, nextProps))
    .forEach((name) => {
      dom.addEventListener(eventType(name), nextProps[name]);
    });
}

function setProperty(dom, name, value) {
  if (name === "nodeValue") {
    dom.nodeValue = value ?? "";
    return;
  }
  if (name === "style" && value && typeof value === "object") {
    // 支持对象形式的 style：style={{ color: "red" }}
    dom.style.cssText = "";
    Object.assign(dom.style, value);
    return;
  }
  if (name === "className") {
    dom.setAttribute("class", value ?? "");
    return;
  }
  // 受控表单等场景：value/checked 等需要写到 DOM property 而非 attribute
  if (name in dom) {
    dom[name] = value ?? "";
    return;
  }
  if (value === null || value === undefined || value === false) {
    dom.removeAttribute(name);
  } else {
    dom.setAttribute(name, value);
  }
}
