/**
 * 协调器 (Reconciler) —— mini-react 的大脑
 *
 * 【核心思想（React 16+ 的 Fiber 架构）】
 *   1. 把「虚拟 DOM 树」转成「Fiber 链表树」。
 *      每个 Fiber 是一个工作单元 (unit of work)。
 *   2. render（协调）阶段可中断：用调度器把工作切片，
 *      处理完一个 Fiber 就检查是否要让步给浏览器。
 *      此阶段只构建 Fiber 树、打标记，不碰真实 DOM。
 *   3. commit 阶段不可中断：一次性把所有变更同步到真实 DOM。
 *   4. 双缓存：current 树（屏幕上的）与 wip 树（正在构建的）
 *      通过 alternate 互相指向，复用 Fiber 对象，减少 GC。
 *
 * 【Fiber 节点结构】
 *   {
 *     type,            // "div" | 函数组件 | TEXT_ELEMENT | Fragment
 *     props, key,
 *     dom,             // 对应真实 DOM（函数组件 / Fragment 为 null）
 *     parent, child, sibling,  // 用链表表达树形结构，便于中断后恢复遍历
 *     alternate,       // 指向上一次渲染对应的 Fiber（双缓存）
 *     effectTag,       // PLACEMENT | UPDATE | DELETION
 *     hooks,           // 函数组件的 hooks 数组
 *   }
 *
 * 【为什么用链表而不是普通树？】
 *   传统的树结构（children 数组）在中断后无法快速恢复到“上次处理到哪里了”。
 *   而链表结构（child/sibling/parent）可以让我们保存任意 Fiber 作为“下一个工作单元”，
 *   中断后直接从这个 Fiber 继续深度优先遍历。
 */

import { createDom } from "./dom.js";
import { commitRoot } from "./commit.js";
import { scheduleWork } from "./scheduler.js";
import { prepareToUseHooks } from "./hooks.js";
import { TEXT_ELEMENT, Fragment } from "./createElement.js";
import { registerRootEvents } from "./syntheticEvents.js";

// ============================================================================
// 模块级调度状态
// ----------------------------------------------------------------------------
// 这些变量在整个模块的生命周期内持续存在，用于跟踪渲染进度。
// 它们是工作循环能够「中断-恢复」的关键。
// ============================================================================

/** 下一个要处理的 Fiber 节点（工作循环的“指针”，中断后从此处恢复） */
let nextUnitOfWork = null;

/** work-in-progress 根 Fiber（正在构建的新树，还没应用到 DOM 上） */
let wipRoot = null;

/** 已经渲染到屏幕上的根 Fiber（上一次 commit 后的结果，用于 diff 对比） */
let currentRoot = null;

/** 本次渲染过程中标记为 DELETION 的旧 Fiber 集合 */
let deletions = null;

/** 工作循环是否已经被调度（防止重复调度，类似防抖） */
let isLoopScheduled = false;

/**
 * render —— 应用入口，把虚拟 DOM 渲染到容器中。
 *
 * 【调用时机】
 *   只在应用初始化时由 createRoot(container).render(<App />) 调用一次。
 *   后续的状态更新由 scheduleUpdate() 触发。
 *
 * 【做了什么】
 *   1. 创建 wipRoot（work-in-progress 根 Fiber），它是整棵新树的起点
 *   2. 把 alternate 指向 currentRoot，开启双缓存对比机制
 *   3. 初始化 deletions 数组和 nextUnitOfWork 指针
 *   4. 启动工作循环（通过调度器异步执行）
 *
 * @param {object} element - 顶层虚拟 DOM Element（如 <App />）
 * @param {HTMLElement} container - 真实 DOM 容器节点（如 document.getElementById('root')）
 */
export function render(element, container) {
  // 在根容器上注册合成事件委托监听器（首次渲染只注册一次）
  registerRootEvents(container);

  wipRoot = {
    dom: container,                 // 根 Fiber 直接引用真实容器 DOM
    props: { children: [element] }, // 顶层组件作为唯一的子节点
    alternate: currentRoot,         // 关联上一次的根，开启双缓存对比
  };
  deletions = [];
  nextUnitOfWork = wipRoot; // 从根节点开始工作
  ensureWorkLoop();         // 启动异步工作循环
}

/**
 * scheduleUpdate —— 由 hooks（如 setState / dispatch）触发的重新渲染。
 *
 * 【与 render() 的区别】
 *   render() 是首次渲染，需要传入 element 和 container。
 *   scheduleUpdate() 是后续更新，基于 currentRoot 重新构建一棵 wip 树。
 *
 * 【工作流程】
 *   1. 如果还没有 currentRoot（还没完成首次渲染），直接返回
 *   2. 基于 currentRoot 创建新的 wipRoot（复用 props 和 DOM）
 *   3. 重新调度工作循环
 *
 * 【注意】
 *   多次连续调用（如事件处理器中连续多次 setState）
 *   会被 ensureWorkLoop 的去重逻辑合并为一次渲染。
 */
export function scheduleUpdate() {
  if (!currentRoot) return; // 首次渲染还没完成，跳过更新
  wipRoot = {
    dom: currentRoot.dom,
    props: currentRoot.props,
    alternate: currentRoot, // 与 currentRoot 建立双缓存关联
  };
  deletions = [];
  nextUnitOfWork = wipRoot;
  ensureWorkLoop();
}

/**
 * ensureWorkLoop —— 确保工作循环已经被调度（防重入）。
 *
 * 【为什么要防重入？】
 *   在一次事件处理中可能会多次调用 setState，
 *   每次都会触发 scheduleUpdate -> ensureWorkLoop。
 *   如果不去重，就会多次调用 scheduleWork，造成不必要的工作。
 *
 * 【原理】
 *   isLoopScheduled 标记保证同一时间只有一个 workLoop 被调度。
 *   当 workLoop 完成后（没有剩余工作），标记会被重置。
 */
function ensureWorkLoop() {
  if (isLoopScheduled) return; // 已经有工作循环在排队，不重复调度
  isLoopScheduled = true;
  scheduleWork(workLoop);     // 通过调度器异步启动工作循环
}

/**
 * workLoop —— 可中断的工作循环，调度器在每一帧中调用。
 *
 * 【工作流程】
 *   1. 循环执行 performUnitOfWork，每次处理一个 Fiber
 *   2. 每处理完一个就检查时间预算（deadline.timeRemaining()）
 *   3. 时间用尽 -> 让步给浏览器，下一帧从 nextUnitOfWork 恢复
 *   4. 所有工作完成 -> 进入 commit 阶段，一次性更新 DOM
 *
 * 【中断与恢复】
 *   nextUnitOfWork 始终指向“下一个要处理的 Fiber”。
 *   当工作被中断时，这个变量会被保留；
 *   下一帧调度器重新调用 workLoop 时，就从这个 Fiber 继续工作。
 *
 * @param {object} deadline - 调度器提供的时间管理对象
 */
function workLoop(deadline) {
  let shouldYield = false;

  // 主循环：在有工作且时间充裕时持续执行
  while (nextUnitOfWork && !shouldYield) {
    // 执行一个工作单元，返回下一个要处理的 Fiber
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
    // 当剩余时间小于 1ms 时，认为本帧预算已用尽，应该让步
    shouldYield = deadline.timeRemaining() < 1;
  }

  // 整棵 wip 树都处理完了（没有剩余工作单元）
  if (!nextUnitOfWork && wipRoot) {
    // 进入 commit 阶段：一次性把所有变更同步到真实 DOM
    commitRoot(wipRoot, deletions);
    // wip 树「转正」成为 current 树，下次更新时用它做 diff 基准
    currentRoot = wipRoot;
    wipRoot = null;
  }

  // 处理调度状态
  if (nextUnitOfWork) {
    scheduleWork(workLoop); // 还有剩余工作，继续调度下一帧执行
  } else {
    isLoopScheduled = false; // 所有工作完成，重置调度标记
  }
}

/**
 * performUnitOfWork —— 处理单个工作单元。
 *
 * 【两个阶段】
 *   1. begin 阶段：根据 Fiber 类型构建子 Fiber 节点
 *      - 函数组件 / Fragment：执行函数，拿到 children，然后 reconcile
 *      - 宿主组件（div/span/文本）：创建 DOM，然后 reconcile children
 *   2. 遍历阶段：返回深度优先遍历的下一个工作单元
 *
 * 【深度优先遍历顺序】
 *   优先向下（child），然后向右（sibling），最后向上回溯（parent.sibling）。
 *   这种遍历顺序与 React Fiber 的链表结构配合，可以在任意节点中断/恢复。
 *
 * 【遍历示例】
 *       App
 *      / \
 *   Counter  Timer
 *
 *   遍历顺序: App -> Counter -> (Counter.sibling) Timer -> (Timer.parent=App, App.sibling) -> null
 *
 * @param {object} fiber - 当前要处理的 Fiber 节点
 * @returns {object|null} 下一个要处理的 Fiber，或 null 表示遍历结束
 */
function performUnitOfWork(fiber) {
  // 判断是否为「复合组件」（函数组件或 Fragment）
  // 复合组件没有自己的 DOM，只负责产出 children
  const isComposite =
    typeof fiber.type === "function" || fiber.type === Fragment;
  if (isComposite) {
    updateFunctionComponent(fiber);
  } else {
    updateHostComponent(fiber);
  }

  // === 深度优先遍历的下一个节点 ===
  // 规则：子 -> 兄弟 -> 叔叔（父级的兄弟，即回溯找 parent.sibling）

  // 1. 优先访问子节点
  if (fiber.child) return fiber.child;

  // 2. 没有子节点，沿着兄弟/父级方向找下一个
  let next = fiber;
  while (next) {
    // 3. 如果有兄弟，访问兄弟
    if (next.sibling) return next.sibling;
    // 4. 没有兄弟，向上回溯到父级，再找父级的兄弟
    next = next.parent;
  }
  // 遍历完整棵树，返回 null
  return null;
}

/**
 * updateFunctionComponent —— 处理函数组件 / Fragment。
 *
 * 【函数组件的处理流程】
 *   1. 调用 prepareToUseHooks(fiber) 重置 hooks 上下文
 *   2. 执行组件函数 fiber.type(fiber.props)，拿到返回的 Element
 *   3. 将返回结果拍平成数组（组件可能返回单个元素、数组或 null）
 *   4. 调用 reconcileChildren 对新旧 children 做 diff
 *
 * 【Fragment 的处理】
 *   Fragment 不需要执行函数，直接把 props.children 作为 children 进行协调。
 *   Fragment 不会产生真实 DOM，它的 children 会直接挂载到最近的 DOM 父节点上。
 *
 * @param {object} fiber - 当前函数组件 / Fragment 的 Fiber 节点
 */
function updateFunctionComponent(fiber) {
  // Fragment 特殊处理：不需要执行函数，直接协调 children
  if (fiber.type === Fragment) {
    reconcileChildren(fiber, fiber.props.children);
    return;
  }

  // 在执行组件函数前，告诉 hooks 模块「当前正在渲染哪个 Fiber」，
  // 这样 hooks 函数内部就能访问到正确的 wipFiber 和 hookIndex
  prepareToUseHooks(fiber);

  // 执行组件函数，传入 props，拿到返回的 Element
  const result = fiber.type(fiber.props);

  // 组件可能返回单个 element、数组、或 null，统一拍平成数组
  const children = [].concat(result).flat(Infinity).filter(Boolean);

  // 对新旧 children 做 diff 协调
  reconcileChildren(fiber, children);
}

/**
 * updateHostComponent —— 处理宿主组件（div/span/文本等真实 DOM 元素）。
 *
 * 【处理流程】
 *   1. 如果还没有对应的 DOM 节点（首次渲染），就创建一个
 *   2. 对 children 做 diff 协调
 *
 * 【注意】
 *   创建 DOM 时不会立即挂载到页面上，
 *   而是在 commit 阶段根据 effectTag 决定是插入、更新还是删除。
 *   这样做的好处是 render 阶段可以安全地中断。
 *
 * @param {object} fiber - 当前宿主组件的 Fiber 节点
 */
function updateHostComponent(fiber) {
  // 懒创建 DOM 节点：只在首次渲染时创建，更新时复用已有的 DOM
  if (!fiber.dom) {
    fiber.dom = createDom(fiber);
  }
  // 对 children 做 diff 协调（新 elements vs 旧 Fiber）
  reconcileChildren(fiber, fiber.props.children);
}

/**
 * reconcileChildren —— 协调（diff）的核心函数。
 *
 * 【职责】
 *   对比「旧 Fiber」（来自上一次渲染）与「新 elements」（本次渲染产出），
 *   为每个子节点生成新的 Fiber，并打上对应的 effectTag。
 *
 * 【支持 key 的 diff 算法】
 *   - 有 key 的节点：通过 key 建立新旧节点的身份对应关系
 *   - 无 key 的节点：按下标位置匹配（兜底策略）
 *   - key 相同 + type 相同 -> 复用 DOM，标记 UPDATE
 *   - key 相同 + type 不同 -> 销毁旧节点，新建 PLACEMENT
 *   - 旧节点没被匹配到 -> 标记 DELETION
 *
 * 【移动检测】
 *   通过 lastPlacedIndex 技巧判断列表项是否发生了移动：
 *   - 如果某个复用节点的旧下标 < lastPlacedIndex，
 *     说明它相对其他节点「往右移动」了，需要标记 PLACEMENT 重新插入
 *   - 这正是 React reconcileChildrenArray 判断列表项是否移动的核心技巧
 *
 * @param {object} wipFiber - 当前正在处理的父级 Fiber 节点
 * @param {Array} elements - 本次渲染产出的新子元素数组
 */
function reconcileChildren(wipFiber, elements) {
  // ============================
  // 步骤 1：收集旧 Fiber 到 Map 中
  // ============================
  // 通过 alternate 找到上一次渲染的同一个父节点，然后遍历它的 children 链表
  const existing = new Map();
  let oldFiber = wipFiber.alternate && wipFiber.alternate.child;
  let index = 0;
  while (oldFiber) {
    // 有 key 用 key 作为标识，否则用下标兜底
    const k = oldFiber.key != null ? oldFiber.key : index;
    // 记录在旧列表中的位置，用于后续的「移动检测」
    oldFiber.oldIndex = index;
    existing.set(k, oldFiber);
    oldFiber = oldFiber.sibling; // 沿链表访问下一个兄弟
    index++;
  }

  let prevSibling = null;

  // lastPlacedIndex：已处理节点在旧列表中的最大下标。
  // 用于判断列表项是否发生了相对移动。
  let lastPlacedIndex = 0;

  // ============================
  // 步骤 2：遍历新 elements，逐个匹配旧 Fiber 并打标记
  // ============================
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    const key = element.key != null ? element.key : i;
    const matched = existing.get(key); // 根据 key/下标查找对应的旧 Fiber
    const sameType = matched && matched.type === element.type;

    let newFiber;
    if (sameType) {
      // ---- 类型相同 -> 复用 DOM，只更新 props ----
      newFiber = {
        type: matched.type,
        props: element.props,      // 使用新的 props
        key: element.key,
        dom: matched.dom,          // 复用旧的 DOM 节点
        parent: wipFiber,
        alternate: matched,        // 建立双缓存关联
        effectTag: "UPDATE",       // 默认标记为 UPDATE
      };

      // 【移动检测】判断是否需要移动 DOM 位置
      if (matched.oldIndex < lastPlacedIndex) {
        // 旧位置在当前已处理节点之前，说明它相对其他节点发生了移动
        // 标记为 PLACEMENT，commit 时会通过 insertBefore 移动到正确位置
        newFiber.effectTag = "PLACEMENT";
      } else {
        // 位置正常，更新 lastPlacedIndex
        lastPlacedIndex = matched.oldIndex;
      }

      existing.delete(key); // 已被复用，从 Map 中移除，避免被当成删除
    } else {
      // ---- 没有匹配 / 类型变了 -> 新建节点 ----
      newFiber = {
        type: element.type,
        props: element.props,
        key: element.key,
        dom: null,               // 新节点还没有 DOM，commit 时创建
        parent: wipFiber,
        alternate: null,          // 没有对应的旧 Fiber
        effectTag: "PLACEMENT",   // 标记为新增，commit 时插入 DOM
      };
    }

    // ============================
    // 步骤 2.1：用 child / sibling 把新 Fiber 串成链表
    // ============================
    if (i === 0) {
      // 第一个子节点：设置为父 Fiber 的 child
      wipFiber.child = newFiber;
    } else {
      // 后续子节点：链接到前一个兄弟的 sibling 上
      prevSibling.sibling = newFiber;
    }
    prevSibling = newFiber;
  }

  // ============================
  // 步骤 3：未被复用的旧 Fiber -> 标记删除
  // ============================
  // Map 中剩余的旧 Fiber 在新树中没有对应节点，说明它们被删除了
  existing.forEach((fiber) => {
    fiber.effectTag = "DELETION";
    deletions.push(fiber); // 加入删除队列，commit 时统一处理
  });
}

export { TEXT_ELEMENT };
