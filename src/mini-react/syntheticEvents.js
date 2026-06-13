/**
 * 合成事件系统 (SyntheticEvent System)
 *
 * 【设计理念】
 *   仿照 React 的合成事件机制，将所有事件统一委托到根容器（root container）上处理，
 *   而不是在每个 DOM 节点上单独绑定 addEventListener。
 *
 * 【核心特性】
 *   1. 事件委托（Event Delegation）
 *      每种事件类型只在 root 上注册一次原生监听器，
 *      当事件触发时，通过 event.target 找到对应的 Fiber 节点。
 *
 *   2. SyntheticEvent 封装
 *      将原生 DOM 事件包装为统一的 SyntheticEvent 对象，
 *      提供 stopPropagation / preventDefault 等标准 API。
 *
 *   3. Fiber 树冒泡
 *      从触发事件的 Fiber 节点开始，沿 parent 链向上遍历，
 *      收集并依次执行路径上所有匹配的事件处理函数（模拟冒泡阶段）。
 *      调用 stopPropagation() 可中断冒泡。
 *
 *   4. 自动清理
 *      使用 WeakSet 跟踪已注册的 root 容器，避免重复注册。
 *      DOM 节点被移除后，其 __miniReactFiber 引用会被 GC 自动回收。
 *
 * 【与 React 的区别】
 *   - React 17+ 把事件委托挂载到 root 节点而非 document
 *   - React 内部区分 capture / bubble 阶段，这里只实现 bubble 阶段
 *   - React 已移除事件池（Event Pooling），这里也不实现
 */

// ============================================================================
// DOM 节点上的 Fiber 引用属性名
// ----------------------------------------------------------------------------
// 每个由 mini-react 创建/更新的真实 DOM 节点都会携带此属性，
// 指向其对应的 Fiber 节点。事件派发时通过此属性从 DOM 找到 Fiber。
// ============================================================================
export const FIBER_PROP = "__miniReactFiber";

// ============================================================================
// 已注册过事件委托的 root 容器集合
// ----------------------------------------------------------------------------
// 使用 WeakSet 的好处：
//   1. 不会阻止 root 被垃圾回收
//   2. O(1) 查找
//   3. 自动清理（root 从 DOM 移除后自动从 WeakSet 消失）
// ============================================================================
const registeredRoots = new WeakSet();

/**
 * SyntheticEvent —— 合成事件对象，封装原生 DOM 事件。
 *
 * 【作用】
 *   提供与原生事件一致的标准 API（target、currentTarget、
 *   stopPropagation、preventDefault 等），同时附加 Fiber 树冒泡能力。
 *
 * 【关键字段】
 *   - nativeEvent:    原始 DOM 事件对象
 *   - target:         事件最初触发的 DOM 元素
 *   - currentTarget:  当前正在处理事件的 Fiber（随冒泡更新）
 *   - type:           事件类型（如 "click"、"input"）
 *
 * @param {Event} nativeEvent - 原生 DOM 事件
 * @param {object} targetFiber - 事件触发源对应的 Fiber 节点
 */
class SyntheticEvent {
  constructor(nativeEvent, targetFiber) {
    this.nativeEvent = nativeEvent;
    this.target = nativeEvent.target;
    this.currentTarget = targetFiber;
    this.type = nativeEvent.type;

    // 冒泡控制标记，调用 stopPropagation() 后为 true
    this._propagationStopped = false;
  }

  /**
   * 阻止事件继续沿 Fiber 树向上冒泡。
   * 已收集的后续处理器将不再被执行。
   *
   * 【注意】
   *   只影响合成事件在 Fiber 树中的冒泡，不阻止原生事件传播。
   *   这样可以确保其他原生监听器（如第三方库）不受影响。
   */
  stopPropagation() {
    this._propagationStopped = true;
  }

  /**
   * 阻止事件的默认行为（如表单提交、链接跳转等）。
   */
  preventDefault() {
    this.nativeEvent.preventDefault();
  }
}

/**
 * 将原生 DOM 事件名转换为 PascalCase，用于拼接 JSX 事件属性名。
 *
 * 【转换规则】
 *   按单词边界拆分全小写的事件名，将每个单词首字母大写后拼接。
 *   单词边界通过常见的事件词干列表来识别（如 key、mouse、touch、drag 等）。
 *
 * 【示例】
 *   "click"      -> "Click"
 *   "keydown"    -> "KeyDown"
 *   "mouseover"  -> "MouseOver"
 *   "dblclick"   -> "DoubleClick"
 *   "touchstart" -> "TouchStart"
 *
 * @param {string} type - 原生 DOM 事件名（如 "keydown"）
 * @returns {string} PascalCase 形式（如 "KeyDown"）
 */
function toPascalCase(type) {
  // 已知的事件词干，按长度降序排列以优先匹配较长的词
  const WORDS = ["dbl", "mouse", "touch", "wheel", "drag", "scroll", "key", "focus", "blur", "input", "change", "submit", "reset", "click", "down", "up", "over", "out", "enter", "leave", "move", "start", "end"];

  const parts = [];
  let rest = type;
  while (rest.length > 0) {
    const word = WORDS.find((w) => rest.startsWith(w));
    if (word) {
      parts.push(word[0].toUpperCase() + word.substring(1));
      rest = rest.substring(word.length);
    } else {
      // 兜底：取剩余全部作为一个单词
      parts.push(rest[0].toUpperCase() + rest.substring(1));
      break;
    }
  }
  return parts.join("");
}

/**
 * 将 JSX 事件属性名转换为原生 DOM 事件名。
 *
 * 转换规则：去掉 "on" 前缀，全部转小写。
 *   "onClick"    -> "click"
 *   "onKeyDown"  -> "keydown"
 *   "onInput"    -> "input"
 *   "onMouseOver" -> "mouseover"
 *
 * @param {string} name - JSX 事件属性名（如 "onClick"）
 * @returns {string} 原生 DOM 事件名（如 "click"）
 */
function eventType(name) {
  return name.toLowerCase().substring(2);
}

/**
 * registerRootEvents —— 在根容器上注册所有事件的委托监听器。
 *
 * 【调用时机】
 *   由 reconciler 的 render() 函数在首次渲染时调用一次。
 *   后续更新不需要重复注册（WeakSet 去重）。
 *
 * 【工作原理】
 *   对每种需要委托的事件类型，在 root 上注册一个捕获阶段监听器（capture: true）。
 *   使用捕获阶段而非冒泡阶段的原因：
 *     - 捕获阶段在事件传播的最早期触发，能确保我们拿到事件的第一手信息
 *     - 某些事件（如 focus/blur）不会冒泡，但会在捕获阶段被监听到
 *     - React 17+ 也是用捕获阶段来统一处理所有事件
 *
 * 【支持的事件类型】
 *   目前预注册了常用事件类型。如果需要支持更多事件，
 *   只需在 SUPPORTED_EVENTS 数组中添加即可。
 *
 * @param {HTMLElement} root - 应用的根容器 DOM 节点
 */
export function registerRootEvents(root) {
  if (registeredRoots.has(root)) return;
  registeredRoots.add(root);

  // 常用事件类型列表，覆盖交互、表单、键盘、鼠标、焦点等场景
  const SUPPORTED_EVENTS = [
    // 鼠标事件
    "click",
    "dblclick",
    "mousedown",
    "mouseup",
    "mousemove",
    "mouseover",
    "mouseout",
    "mouseenter",
    "mouseleave",
    // 触摸事件
    "touchstart",
    "touchend",
    "touchmove",
    // 键盘事件
    "keydown",
    "keyup",
    "keypress",
    // 表单事件
    "input",
    "change",
    "submit",
    "reset",
    // 焦点事件
    "focus",
    "blur",
    // 滚动 & 拖拽
    "scroll",
    "wheel",
    "dragstart",
    "dragend",
    "dragover",
    "drop",
  ];

  SUPPORTED_EVENTS.forEach((eventName) => {
    // 使用捕获阶段（第三个参数 true），确保最早拦截到事件
    root.addEventListener(eventName, (nativeEvent) => {
      dispatchEvent(root, nativeEvent);
    }, true);
  });
}

/**
 * dispatchEvent —— 事件派发核心逻辑。
 *
 * 【执行流程】
 *   1. 通过 event.target 上的 FIBER_PROP 找到触发事件的 Fiber 节点
 *   2. 从该 Fiber 开始，沿 parent 链向上遍历整条路径
 *   3. 在每个 Fiber 上检查是否有对应的事件处理 prop（如 onClick）
 *   4. 按冒泡顺序（从目标到根）依次执行收集到的处理器
 *   5. 如果某个处理器调用了 stopPropagation()，后续处理器不再执行
 *
 * 【为什么先收集再执行？】
 *   Fiber 树冒泡方向是从子到父（target -> root），
 *   这和 DOM 事件的冒泡方向一致。先收集路径再执行，
 *   可以保证 currentTarget 在每次调用时正确指向当前 Fiber。
 *
 * @param {HTMLElement} root - 根容器 DOM 节点
 * @param {Event} nativeEvent - 原生 DOM 事件
 */
function dispatchEvent(root, nativeEvent) {
  // 通过 DOM 节点上的 Fiber 引用找到源 Fiber
  const targetDom = nativeEvent.target;
  if (!targetDom) return;

  const targetFiber = targetDom[FIBER_PROP];
  if (!targetFiber) return;

  // 将原生事件名映射为 JSX 属性名。
  // nativeEvent.type 是全小写（如 "click"、"keydown"、"mouseover"），
  // 而 JSX 采用驼峰命名（onClick、onKeyDown、onMouseOver），
  // 需要按单词边界拆分后逐个首字母大写再拼接。
  const eventName = "on" + toPascalCase(nativeEvent.type);

  // 创建合成事件对象
  const syntheticEvent = new SyntheticEvent(nativeEvent, targetFiber);

  // 第一步：收集冒泡路径上所有的处理器
  // 从 target Fiber 开始，沿 parent 链向上收集
  const handlers = [];
  let fiber = targetFiber;
  while (fiber) {
    if (fiber.props && typeof fiber.props[eventName] === "function") {
      handlers.push({ handler: fiber.props[eventName], fiber });
    }
    fiber = fiber.parent;
  }

  // 第二步：按冒泡顺序依次执行（handlers 已经是 target -> root 的顺序）
  for (let i = 0; i < handlers.length; i++) {
    if (syntheticEvent._propagationStopped) break;
    // 更新 currentTarget 为当前正在处理的 Fiber
    syntheticEvent.currentTarget = handlers[i].fiber;
    handlers[i].handler(syntheticEvent);
  }
}
