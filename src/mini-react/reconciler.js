// ============================================================================
// 协调器 (Reconciler) —— mini-react 的大脑
// ----------------------------------------------------------------------------
// 核心思想（React 16+ 的 Fiber 架构）：
//   1. 把「虚拟 DOM 树」转成「Fiber 链表树」。每个 Fiber 是一个工作单元(unit of work)。
//   2. render（协调）阶段可中断：用调度器把工作切片，处理完一个 Fiber 就检查
//      是否要让步给浏览器。此阶段只构建 Fiber 树、打标记，不碰真实 DOM。
//   3. commit 阶段不可中断：一次性把所有变更同步到真实 DOM。
//   4. 双缓存：current 树（屏幕上的）与 wip 树（正在构建的）通过 alternate 互相指向，
//      复用 Fiber 对象，减少 GC。
//
// Fiber 节点结构：
//   {
//     type,            // "div" | 函数组件 | TEXT_ELEMENT | Fragment
//     props, key,
//     dom,             // 对应真实 DOM（函数组件 / Fragment 为 null）
//     parent, child, sibling,  // 用链表表达树形结构，便于中断后恢复遍历
//     alternate,       // 指向上一次渲染对应的 Fiber（双缓存）
//     effectTag,       // PLACEMENT | UPDATE | DELETION
//     hooks,           // 函数组件的 hooks 链表
//   }
// ============================================================================

import { createDom } from "./dom.js";
import { commitRoot } from "./commit.js";
import { scheduleWork } from "./scheduler.js";
import { prepareToUseHooks } from "./hooks.js";
import { TEXT_ELEMENT, Fragment } from "./createElement.js";

// ---- 调度状态 ---------------------------------------------------------------
let nextUnitOfWork = null; // 下一个要处理的 Fiber
let wipRoot = null; // work-in-progress 根 Fiber（正在构建的树）
let currentRoot = null; // 已经渲染到屏幕上的根 Fiber
let deletions = null; // 本次需要删除的旧 Fiber 集合
let isLoopScheduled = false;

// ---- 入口：把虚拟 DOM 渲染到容器 ---------------------------------------------
export function render(element, container) {
  wipRoot = {
    dom: container,
    props: { children: [element] },
    alternate: currentRoot, // 关联上一次的根，开启双缓存对比
  };
  deletions = [];
  nextUnitOfWork = wipRoot;
  ensureWorkLoop();
}

// 由 hooks（如 setState）触发的更新：基于 current 树重新构建一棵 wip 树。
export function scheduleUpdate() {
  if (!currentRoot) return;
  wipRoot = {
    dom: currentRoot.dom,
    props: currentRoot.props,
    alternate: currentRoot,
  };
  deletions = [];
  nextUnitOfWork = wipRoot;
  ensureWorkLoop();
}

function ensureWorkLoop() {
  if (isLoopScheduled) return;
  isLoopScheduled = true;
  scheduleWork(workLoop);
}

// ---- 可中断的工作循环 -------------------------------------------------------
function workLoop(deadline) {
  let shouldYield = false;
  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
    // 时间预算用尽就让步，把控制权还给浏览器，下一帧再继续。
    shouldYield = deadline.timeRemaining() < 1;
  }

  // 整棵 wip 树都处理完了 -> 进入 commit 阶段，一次性更新 DOM。
  if (!nextUnitOfWork && wipRoot) {
    commitRoot(wipRoot, deletions);
    currentRoot = wipRoot; // wip 树「转正」成为 current 树
    wipRoot = null;
  }

  if (nextUnitOfWork) {
    scheduleWork(workLoop); // 还有活没干完，继续排队
  } else {
    isLoopScheduled = false;
  }
}

// ---- 处理单个工作单元：先 begin（构建子 Fiber），再返回下一个工作单元 --------
function performUnitOfWork(fiber) {
  // 函数组件与 Fragment 都没有自己的 DOM，只负责产出 children。
  const isComposite =
    typeof fiber.type === "function" || fiber.type === Fragment;
  if (isComposite) {
    updateFunctionComponent(fiber);
  } else {
    updateHostComponent(fiber);
  }

  // 深度优先遍历的下一个节点：子 -> 兄弟 -> 叔叔（回溯父级的兄弟）。
  // 用链表表达让我们能在任意时刻中断、之后从 nextUnitOfWork 精确恢复。
  if (fiber.child) return fiber.child;
  let next = fiber;
  while (next) {
    if (next.sibling) return next.sibling;
    next = next.parent;
  }
  return null;
}

// 函数组件 / Fragment：执行它拿到 children，再去协调。
function updateFunctionComponent(fiber) {
  if (fiber.type === Fragment) {
    reconcileChildren(fiber, fiber.props.children);
    return;
  }
  // 在执行组件函数前，让 hooks 模块知道「当前正在渲染哪个 Fiber」。
  prepareToUseHooks(fiber);
  const result = fiber.type(fiber.props);
  // 组件可能返回单个 element、数组或 null，统一拍平成数组。
  const children = [].concat(result).flat(Infinity).filter(Boolean);
  reconcileChildren(fiber, children);
}

// 宿主组件（div/span/文本...）：没有就创建对应 DOM，然后协调 children。
function updateHostComponent(fiber) {
  if (!fiber.dom) {
    fiber.dom = createDom(fiber);
  }
  reconcileChildren(fiber, fiber.props.children);
}

// ---- 协调（diff）：对比「旧 Fiber」与「新 elements」，为每个孩子生成新 Fiber ----
// 支持 key：通过 key 建立新旧节点的身份对应关系，从而复用 Fiber / DOM、保留状态。
function reconcileChildren(wipFiber, elements) {
  // 1. 把旧 Fiber（来自 alternate）收集进 Map，key 优先，否则用下标兜底。
  const existing = new Map();
  let oldFiber = wipFiber.alternate && wipFiber.alternate.child;
  let index = 0;
  while (oldFiber) {
    const k = oldFiber.key != null ? oldFiber.key : index;
    oldFiber.oldIndex = index; // 记录在旧列表中的位置，用于判断是否发生「移动」
    existing.set(k, oldFiber);
    oldFiber = oldFiber.sibling;
    index++;
  }

  let prevSibling = null;
  // lastPlacedIndex：已处理节点在旧列表中的最大下标。
  // 若某个复用节点的旧下标 < 它，说明它相对其他节点「往右移动」了，需要重新插入。
  // 这正是 React reconcileChildrenArray 判断列表项是否移动的核心技巧。
  let lastPlacedIndex = 0;

  // 2. 遍历新 elements，逐个匹配旧 Fiber 并打标记。
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    const key = element.key != null ? element.key : i;
    const matched = existing.get(key);
    const sameType = matched && matched.type === element.type;

    let newFiber;
    if (sameType) {
      // 类型相同 -> 复用 DOM。默认只更新 props（UPDATE）。
      newFiber = {
        type: matched.type,
        props: element.props,
        key: element.key,
        dom: matched.dom,
        parent: wipFiber,
        alternate: matched,
        effectTag: "UPDATE",
      };
      // 判断是否需要移动 DOM 位置。
      if (matched.oldIndex < lastPlacedIndex) {
        newFiber.effectTag = "PLACEMENT"; // 需要移动：commit 时会 insertBefore 到正确位置
      } else {
        lastPlacedIndex = matched.oldIndex;
      }
      existing.delete(key); // 已被复用，避免后面被当成删除
    } else {
      // 没有匹配，或类型变了 -> 新建节点（PLACEMENT）。
      newFiber = {
        type: element.type,
        props: element.props,
        key: element.key,
        dom: null,
        parent: wipFiber,
        alternate: null,
        effectTag: "PLACEMENT",
      };
    }

    // 用 child / sibling 把新 Fiber 串成链表。
    if (i === 0) {
      wipFiber.child = newFiber;
    } else {
      prevSibling.sibling = newFiber;
    }
    prevSibling = newFiber;
  }

  // 3. Map 里没被复用的旧 Fiber，说明在新树里消失了 -> 标记删除。
  existing.forEach((fiber) => {
    fiber.effectTag = "DELETION";
    deletions.push(fiber);
  });
}

export { TEXT_ELEMENT };
