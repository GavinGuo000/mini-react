// ============================================================================
// commit 阶段 —— 把 render 阶段打好的标记一次性同步到真实 DOM
// ----------------------------------------------------------------------------
// 这个阶段是「同步、不可中断」的，保证用户不会看到渲染到一半的中间态。
// 步骤：
//   1. 处理所有 DELETION（并执行被删子树里的 effect 清理函数）
//   2. 遍历 wip 树，处理 PLACEMENT / UPDATE
//   3. 执行 useEffect（cleanup 旧的 -> 运行新的）
// ============================================================================

import { updateDom } from "./dom.js";

export function commitRoot(wipRoot, deletions) {
  deletions.forEach(commitDeletion);
  commitWork(wipRoot.child);
  runEffects(wipRoot.child);
}

function commitWork(fiber) {
  if (!fiber) return;

  if (fiber.effectTag === "PLACEMENT" && fiber.dom != null) {
    // 复用但需要移动的节点：props 也可能变了，先更新属性再移动位置。
    if (fiber.alternate) {
      updateDom(fiber.dom, fiber.alternate.props, fiber.props);
    }
    const parentDom = getParentDom(fiber);
    // 找到「应当插在它前面」的那个真实 DOM 锚点，保证顺序正确（含列表重排场景）。
    // insertBefore 对已在文档中的节点会自动「移动」它。
    const anchor = getHostSibling(fiber);
    parentDom.insertBefore(fiber.dom, anchor);
  } else if (fiber.effectTag === "UPDATE" && fiber.dom != null) {
    updateDom(fiber.dom, fiber.alternate.props, fiber.props);
  }

  commitWork(fiber.child);
  commitWork(fiber.sibling);
}

// 函数组件 / Fragment 自身没有 DOM，需要向上找到最近的有 DOM 的父级。
function getParentDom(fiber) {
  let parent = fiber.parent;
  while (parent && !parent.dom) {
    parent = parent.parent;
  }
  return parent.dom;
}

// 找到当前 Fiber 在真实 DOM 中右侧最近的、已经挂载好的兄弟节点，作为 insertBefore 锚点。
// 这是 React 处理「插入/移动」时保持顺序的关键（简化版 getHostSibling）。
function getHostSibling(fiber) {
  let node = fiber.sibling;
  while (node) {
    // 跳过待插入(PLACEMENT)的、以及没有 DOM 的（函数组件/Fragment 需深入其子树）。
    if (node.effectTag !== "PLACEMENT") {
      if (node.dom) return node.dom;
      // 没有自身 DOM，去它的子树里找第一个稳定的 DOM。
      const childDom = findFirstHostDom(node);
      if (childDom) return childDom;
    }
    node = node.sibling;
  }
  return null; // 没有锚点 -> insertBefore(dom, null) 等价于 appendChild
}

function findFirstHostDom(fiber) {
  let child = fiber.child;
  while (child) {
    if (child.effectTag !== "PLACEMENT") {
      if (child.dom) return child.dom;
      const deep = findFirstHostDom(child);
      if (deep) return deep;
    }
    child = child.sibling;
  }
  return null;
}

// 删除：先跑该子树里所有 effect 的 cleanup，再从真实 DOM 中移除。
function commitDeletion(fiber) {
  runCleanup(fiber);
  const node = findFirstHostDom(fiber) || fiber.dom;
  // 找到真正承载它的 DOM 节点并移除。函数组件需要往下找第一个真实 DOM。
  let domFiber = fiber;
  while (domFiber && !domFiber.dom) {
    domFiber = domFiber.child;
  }
  if (domFiber && domFiber.dom && domFiber.dom.parentNode) {
    domFiber.dom.parentNode.removeChild(domFiber.dom);
  } else if (node && node.parentNode) {
    node.parentNode.removeChild(node);
  }
}

// ---- effect 执行 ------------------------------------------------------------
// 遍历整棵 wip 树，运行那些依赖发生变化的 useEffect。
// 说明：为保持实现清晰，这里在 commit 末尾「同步」执行 effect；
//      真实 React 的 useEffect 是在浏览器绘制之后异步执行的。
function runEffects(fiber) {
  if (!fiber) return;
  if (fiber.hooks) {
    fiber.hooks
      .filter((hook) => hook.tag === "effect" && hook.hasChanged)
      .forEach((hook) => {
        if (typeof hook.cleanup === "function") hook.cleanup();
        hook.cleanup = hook.effect();
      });
  }
  runEffects(fiber.child);
  runEffects(fiber.sibling);
}

// 删除节点时，运行其子树内所有 effect 的清理函数。
function runCleanup(fiber) {
  if (!fiber) return;
  if (fiber.hooks) {
    fiber.hooks
      .filter((hook) => hook.tag === "effect" && typeof hook.cleanup === "function")
      .forEach((hook) => hook.cleanup());
  }
  let child = fiber.child;
  while (child) {
    runCleanup(child);
    child = child.sibling;
  }
}
