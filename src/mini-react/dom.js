/**
 * DOM 操作层 —— 把 Fiber 上的 props 落实到真实 DOM 上
 *
 * 【职责】
 *   本模块是 Fiber 与真实 DOM 之间的桥梁。
 *   Fiber 树在 render 阶段只负责“打标”（PLACEMENT/UPDATE/DELETION），
 *   而实际创建 DOM 节点、设置属性、绑定事件的工作都由本模块完成。
 *
 * 【处理的三类 props】
 *   1. 事件属性   onClick / onInput ...        -> addEventListener / removeEventListener
 *   2. children   由协调器单独处理，这里跳过
 *   3. 普通属性   className / style / value ... -> 直接挂到 DOM 节点上
 *
 * 【与 React 的区别】
 *   React 使用“合成事件”（SyntheticEvent），将所有事件委托到 document 上统一处理。
 *   这里我们直接使用原生 addEventListener，更简单但缺少事件池、事件委托等优化。
 */

import { TEXT_ELEMENT } from "./createElement.js";

// ============================================================================
// 工具函数：用于分类和比较 props 的纯函数
// ============================================================================

/** 判断是否是事件属性（以 "on" 开头的属性名，如 onClick、onInput） */
const isEvent = (key) => key.startsWith("on");

/** 判断是否是普通属性（非 children 且非事件） */
const isProperty = (key) => key !== "children" && !isEvent(key);

/** 判断某个属性在新旧 props 之间是否发生了变化（包括新增和修改） */
const isNew = (prev, next) => (key) => prev[key] !== next[key];

/** 判断某个属性是否在新 props 中被删除了 */
const isGone = (next) => (key) => !(key in next);

/**
 * 将 JSX 事件属性名转换为原生 DOM 事件名。
 *
 * 【转换规则】
 *   React 的事件属性名采用驼峰命名（onClick、onMouseOver），
 *   而原生 DOM 事件名是全小写（click、mouseover）。
 *   转换方法：去掉 "on" 前缀，然后全部转小写。
 *
 * 【示例】
 *   "onClick"    -> "click"
 *   "onKeyDown"  -> "keydown"
 *   "onInput"    -> "input"
 *
 * @param {string} name - JSX 事件属性名（如 "onClick"）
 * @returns {string} 原生 DOM 事件名（如 "click"）
 */
function eventType(name) {
  return name.toLowerCase().substring(2);
}

/**
 * 根据 Fiber 节点创建对应的真实 DOM 节点。
 *
 * 【创建流程】
 *   1. 根据 type 判断是创建 TextNode（文本节点）还是 Element（元素节点）
 *   2. 调用 updateDom 把 props 应用到刚创建的 DOM 节点上
 *   3. 返回创建好的 DOM 节点
 *
 * 【注意】
 *   创建时使用空字符串初始化（document.createTextNode("")、document.createElement(type)），
 *   实际的属性/内容填充交给 updateDom 完成，这样可以复用同一套属性设置逻辑。
 *
 * @param {object} fiber - Fiber 节点对象
 * @returns {HTMLElement|Text} 创建好的真实 DOM 节点
 */
export function createDom(fiber) {
  // 根据 Fiber 的 type 创建对应的 DOM 节点：
  // - TEXT_ELEMENT 类型 -> 创建 TextNode（用于渲染纯文本内容）
  // - 其他类型（如 "div"、"span"） -> 创建对应的 HTML 元素
  const dom =
    fiber.type === TEXT_ELEMENT
      ? document.createTextNode("")
      : document.createElement(fiber.type);

  // 把 Fiber 上的 props 应用到真实 DOM 上（包括属性、事件、样式等）
  updateDom(dom, {}, fiber.props);
  return dom;
}

/**
 * 对比新旧 props，最小化更新真实 DOM 上的属性和事件。
 *
 * 【核心思想】
 *   这是 React「同一节点更新」时的核心逻辑。
 *   通过对比 prevProps 和 nextProps，只对发生变化的部分做精确更新，
 *   避免全量替换带来的性能损失。
 *
 * 【更新步骤】（顺序很重要）
 *   1. 移除旧的事件监听  — 防止已删除或已变更的事件被重复触发
 *   2. 删除已消失的属性 — 把 DOM 上多余的 attribute/property 清除掉
 *   3. 设置新增或变化的属性 — 把新值写入 DOM
 *   4. 绑定新增或变化的事件 — 确保新的事件处理器生效
 *
 * @param {HTMLElement|Text} dom - 要更新的真实 DOM 节点
 * @param {object} prevProps - 上一次渲染时的 props
 * @param {object} nextProps - 本次渲染的 props
 */
export function updateDom(dom, prevProps, nextProps) {
  // 步骤 1：移除已经不存在或发生变化的旧事件监听
  // 为什么要先移除？因为如果事件的回调函数变了，不移除旧的就会同时触发新旧两个回调
  Object.keys(prevProps)
    .filter(isEvent)
    .filter((key) => !(key in nextProps) || isNew(prevProps, nextProps)(key))
    .forEach((name) => {
      dom.removeEventListener(eventType(name), prevProps[name]);
    });

  // 步骤 2：删除已经不存在的旧属性
  // 例如上次有 disabled={true}，这次没有了，就需要把 disabled 属性移除
  Object.keys(prevProps)
    .filter(isProperty)
    .filter(isGone(nextProps))
    .forEach((name) => {
      setProperty(dom, name, null);
    });

  // 步骤 3：设置新增或变化的属性
  // 包括 className、style、value、href 等所有非事件属性
  Object.keys(nextProps)
    .filter(isProperty)
    .filter(isNew(prevProps, nextProps))
    .forEach((name) => {
      setProperty(dom, name, nextProps[name]);
    });

  // 步骤 4：绑定新增或变化的事件监听
  // 将新的回调函数通过 addEventListener 绑定到 DOM 节点上
  Object.keys(nextProps)
    .filter(isEvent)
    .filter(isNew(prevProps, nextProps))
    .forEach((name) => {
      dom.addEventListener(eventType(name), nextProps[name]);
    });
}

/**
 * 将单个属性设置到真实 DOM 节点上。
 *
 * 【处理策略】（按优先级从高到低）
 *   1. nodeValue  — 文本节点的文本内容（TextElement 专用）
 *   2. style     — 对象形式的内联样式：style={{ color: "red", fontSize: 14 }}
 *   3. className — 转换为 HTML 的 class 属性
 *   4. DOM property — 如 value、checked、disabled 等，直接赋值到 DOM 对象属性
 *   5. attribute  — 其他所有属性，通过 setAttribute 设置
 *   6. 特殊值处理  — null/undefined/false 时移除属性
 *
 * 【property vs attribute 的区别】
 *   - property 是 DOM 对象上的 JS 属性（如 input.value）
 *   - attribute 是 HTML 标签上的属性（如 <input value="xxx">）
 *   - 对于受控表单组件，需要写 property 而不是 attribute，
 *     因为 property 反映的是当前实时状态
 *
 * @param {HTMLElement|Text} dom - 目标 DOM 节点
 * @param {string} name - 属性名
 * @param {*} value - 属性值，null 表示删除该属性
 */
function setProperty(dom, name, value) {
  // 处理文本节点的 nodeValue（TEXT_ELEMENT 类型节点的文本内容）
  if (name === "nodeValue") {
    dom.nodeValue = value ?? "";
    return;
  }

  // 处理对象形式的内联样式：style={{ color: "red", fontSize: "14px" }}
  // 先清空旧的 cssText，再用 Object.assign 将新的样式对象合并到 style 上
  if (name === "style" && value && typeof value === "object") {
    dom.style.cssText = "";
    Object.assign(dom.style, value);
    return;
  }

  // 处理 className -> 转换为 HTML 的 class 属性
  // React 使用 className 而不是 class，是因为 class 是 JS 的保留字
  if (name === "className") {
    dom.setAttribute("class", value ?? "");
    return;
  }

  // 处理 DOM property（如 value、checked、disabled 等）
  // 如果属性名是 DOM 对象自身的属性，直接赋值到 JS 属性上
  // 这对受控表单组件很重要：input.value 必须写 property 而不是 attribute
  if (name in dom) {
    dom[name] = value ?? "";
    return;
  }

  // 其他属性：通过 setAttribute/removeAttribute 操作 HTML attribute
  // 当值为 null/undefined/false 时，移除该属性（常见于条件属性，如 disabled={false}）
  if (value === null || value === undefined || value === false) {
    dom.removeAttribute(name);
  } else {
    dom.setAttribute(name, value);
  }
}
