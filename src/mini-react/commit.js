/**
 * commit 阶段 —— 把 render 阶段打好的标记一次性同步到真实 DOM。
 *
 * 【核心原则】
 *   这个阶段是「同步、不可中断」的，保证用户不会看到渲染到一半的中间态。
 *   一旦进入 commit，所有的 DOM 操作都会一口气执行完毕。
 *
 * 【执行步骤】
 *   1. 处理所有 DELETION — 先执行被删子树里的 effect 清理函数，再移除 DOM
 *   2. 遍历 wip 树，处理 PLACEMENT（插入/移动）/ UPDATE（更新属性）
 *   3. 执行 useEffect — 先运行上一次的 cleanup，再运行新的 effect
 *
 * 【与 React 的区别】
 *   - React 的 commit 分为 Before Mutation、Mutation、Layout 三个子阶段
 *   - React 的 useEffect 是在浏览器绘制之后异步执行的（useLayoutEffect 才是同步）
 *   - 这里为了简化，将 useEffect 也放在 commit 末尾同步执行
 */

import { updateDom } from "./dom.js";

/**
 * commitRoot —— commit 阶段的入口函数。
 *
 * 【执行顺序】
 *   1. 先处理删除：deletions 中的 Fiber 会先清理 effect，再从 DOM 移除
 *   2. 再处理插入/更新：遍历 wip 树，根据 effectTag 执行 DOM 操作
 *   3. 最后执行 useEffect：运行依赖发生变化的副作用函数
 *
 * 【为什么删除要最先处理？】
 *   因为删除的节点可能还引用着 DOM 节点、定时器等资源，
 *   先清理可以避免在后续插入/更新时产生冲突。
 *
 * @param {object} wipRoot - work-in-progress 根 Fiber
 * @param {Array} deletions - 本次需要删除的旧 Fiber 集合
 */
export function commitRoot(wipRoot, deletions) {
  // 步骤 1：处理所有待删除的节点（包含 effect 清理）
  deletions.forEach(commitDeletion);
  // 步骤 2：处理所有插入和更新操作（遍历 wip 树）
  commitWork(wipRoot.child);
  // 步骤 3：执行 useEffect（依赖变化的才执行）
  runEffects(wipRoot.child);
}

/**
 * commitWork —— 递归遍历 wip 树，把 PLACEMENT/UPDATE 标记落实到 DOM。
 *
 * 【处理逻辑】
 *   - PLACEMENT + 有 DOM：
 *     - 如果有 alternate（复用节点但位置变了），先更新 props，再移动到正确位置
 *     - 如果是全新节点，直接插入到父 DOM 中
 *   - UPDATE + 有 DOM：
 *     - 对比新旧 props，只更新发生变化的属性和事件
 *
 * 【插入位置的计算】
 *   通过 getHostSibling 找到右侧最近已挂载的兄弟 DOM 节点作为锚点，
 *   使用 insertBefore(dom, anchor) 插入到正确位置。
 *   如果 anchor 为 null，等价于 appendChild。
 *
 * @param {object|null} fiber - 当前要处理的 Fiber 节点
 */
function commitWork(fiber) {
  if (!fiber) return;

  if (fiber.effectTag === "PLACEMENT" && fiber.dom != null) {
    // PLACEMENT：节点需要插入或移动
    if (fiber.alternate) {
      // 这是复用但需要移动的节点：props 也可能变了，先更新属性再移动位置
      updateDom(fiber.dom, fiber.alternate.props, fiber.props);
    }
    // 找到最近的有 DOM 的父级（跳过函数组件/Fragment）
    const parentDom = getParentDom(fiber);
    // 找到右侧最近的已挂载兄弟节点作为 insertBefore 锚点
    // insertBefore 对已在文档中的节点会自动「移动」它，所以同时处理了插入和移动
    const anchor = getHostSibling(fiber);
    parentDom.insertBefore(fiber.dom, anchor);

  } else if (fiber.effectTag === "UPDATE" && fiber.dom != null) {
    // UPDATE：节点位置不变，只更新 props（属性、事件等）
    updateDom(fiber.dom, fiber.alternate.props, fiber.props);
  }

  // 递归处理子节点和兄弟节点
  commitWork(fiber.child);
  commitWork(fiber.sibling);
}

/**
 * getParentDom —— 向上查找最近的拥有真实 DOM 的父级 Fiber。
 *
 * 【为什么需要向上找？】
 *   函数组件和 Fragment 自身没有对应的 DOM 节点（fiber.dom 为 null），
 *   但它们的子节点需要被挂载到某个真实的 DOM 父节点上。
 *   所以需要沿着 parent 链向上找，直到找到有 dom 的 Fiber。
 *
 * 【示例】
 *   <div>             <- dom: HTMLDivElement
 *     <App>           <- dom: null（函数组件）
 *       <Counter>     <- dom: null（函数组件）
 *         <button>    <- dom: HTMLButtonElement，它的 parentDom 就是上面的 div
 *
 * @param {object} fiber - 当前 Fiber 节点
 * @returns {HTMLElement} 最近的真实 DOM 父节点
 */
function getParentDom(fiber) {
  let parent = fiber.parent;
  while (parent && !parent.dom) {
    parent = parent.parent; // 跳过没有 DOM 的函数组件/Fragment
  }
  return parent.dom;
}

/**
 * getHostSibling —— 找到当前 Fiber 在真实 DOM 中右侧最近的、已挂载的兄弟节点。
 *
 * 【作用】
 *   作为 insertBefore 的锚点，确保新插入/移动的节点位于正确的 DOM 位置。
 *   这是 React 处理「插入/移动」时保持顺序的关键。
 *
 * 【查找规则】
 *   1. 从 fiber.sibling 开始向右遍历
 *   2. 跳过 PLACEMENT 标记的节点（它们还没挂载到 DOM）
 *   3. 如果兄弟有 dom，直接返回
 *   4. 如果兄弟是函数组件/Fragment（没有 dom），深入其子树找第一个稳定的 DOM
 *   5. 都没找到返回 null（等价于 appendChild）
 *
 * @param {object} fiber - 当前 Fiber 节点
 * @returns {HTMLElement|null} 右侧最近的已挂载 DOM 节点，或 null
 */
function getHostSibling(fiber) {
  let node = fiber.sibling;
  while (node) {
    // 只考虑已经挂载到 DOM 的节点（非 PLACEMENT 标记）
    if (node.effectTag !== "PLACEMENT") {
      // 兄弟节点有 DOM，直接作为锚点
      if (node.dom) return node.dom;
      // 兄弟是函数组件/Fragment（没有 DOM），深入其子树找第一个稳定的 DOM
      const childDom = findFirstHostDom(node);
      if (childDom) return childDom;
    }
    // 继续向右查找下一个兄弟
    node = node.sibling;
  }
  // 没有找到锚点 -> insertBefore(dom, null) 等价于 appendChild
  return null;
}

/**
 * findFirstHostDom —— 在 Fiber 子树中深度查找第一个已挂载的真实 DOM 节点。
 *
 * 【作用】
 *   当兄弟节点是函数组件/Fragment（没有自身 DOM）时，
 *   需要深入它的子树找到第一个真实 DOM，作为 insertBefore 的锚点。
 *
 * @param {object} fiber - 起始 Fiber 节点
 * @returns {HTMLElement|Text|null} 第一个稳定的 DOM 节点
 */
function findFirstHostDom(fiber) {
  let child = fiber.child;
  while (child) {
    // 只考虑已经挂载的节点
    if (child.effectTag !== "PLACEMENT") {
      if (child.dom) return child.dom;
      // 递归深入子树查找
      const deep = findFirstHostDom(child);
      if (deep) return deep;
    }
    child = child.sibling;
  }
  return null;
}

/**
 * commitDeletion —— 删除一个 Fiber 子树对应的 DOM 节点。
 *
 * 【处理流程】
 *   1. 运行该子树内所有 useEffect 的 cleanup 函数（防止内存泄漏）
 *   2. 找到真正承载 DOM 的 Fiber 节点并移除
 *
 * 【为什么要找 domFiber？】
 *   函数组件本身没有 DOM，被删除时需要向下找到它渲染出的第一个真实 DOM。
 *   例如删除 <Timer /> 组件时，需要找到 Timer 内部的 <div> 或 <span> 并移除。
 *
 * @param {object} fiber - 被标记为 DELETION 的 Fiber 节点
 */
function commitDeletion(fiber) {
  // 先运行该子树里所有 effect 的 cleanup（防止定时器、订阅等泄漏）
  runCleanup(fiber);

  // 尝试找到子树中的第一个稳定 DOM 节点（用于兑底删除）
  const node = findFirstHostDom(fiber) || fiber.dom;

  // 从当前 Fiber 向下找第一个有 DOM 的节点
  let domFiber = fiber;
  while (domFiber && !domFiber.dom) {
    domFiber = domFiber.child;
  }

  // 优先通过 domFiber 移除，兑底通过 findFirstHostDom 找到的节点移除
  if (domFiber && domFiber.dom && domFiber.dom.parentNode) {
    domFiber.dom.parentNode.removeChild(domFiber.dom);
  } else if (node && node.parentNode) {
    node.parentNode.removeChild(node);
  }
}

/**
 * runEffects —— 遍历整棵 wip 树，执行依赖发生变化的 useEffect。
 *
 * 【执行逻辑】
 *   1. 筛选出 tag 为 "effect" 且 hasChanged 为 true 的 hook
 *   2. 先运行上一次的 cleanup 函数（如果有的话）
 *   3. 执行本次的 effect 函数，并把它的返回值（新的 cleanup）存储起来
 *
 * 【hasChanged 何时为 true？】
 *   - 首次渲染：没有旧 hook，hasChanged 始终为 true
 *   - 依赖数组变化：新旧 deps 浅比较不相等
 *   - 不传依赖数组：deps 为 undefined，hasChanged 始终为 true
 *
 * 【与 React 的区别】
 *   真实 React 的 useEffect 是在浏览器绘制之后异步执行的，
 *   这里为了简化，在 commit 末尾同步执行。
 *
 * @param {object|null} fiber - 当前遍历的 Fiber 节点
 */
function runEffects(fiber) {
  if (!fiber) return;

  // 如果当前 Fiber 有 hooks，执行变化的 effect
  if (fiber.hooks) {
    fiber.hooks
      .filter((hook) => hook.tag === "effect" && hook.hasChanged)
      .forEach((hook) => {
        // 先清理上一次的 effect（比如清除定时器、取消订阅）
        if (typeof hook.cleanup === "function") hook.cleanup();
        // 执行新的 effect，并把返回的 cleanup 函数存储起来
        // 下次同一个 effect 再执行时，会先调用这个 cleanup
        hook.cleanup = hook.effect();
      });
  }

  // 递归遍历子节点和兄弟节点
  runEffects(fiber.child);
  runEffects(fiber.sibling);
}

/**
 * runCleanup —— 删除节点时，递归运行其子树内所有 effect 的清理函数。
 *
 * 【调用时机】
 *   在 commitDeletion 中调用，确保被删除组件的定时器、订阅、事件监听等资源被释放。
 *
 * 【为什么需要递归遍历子树？】
 *   一个组件可能渲染了多个子组件，每个子组件都可能有自己的 useEffect。
 *   删除父组件时，所有子组件的 effect 都需要被清理。
 *
 * @param {object|null} fiber - 被删除的 Fiber 节点
 */
function runCleanup(fiber) {
  if (!fiber) return;

  // 运行当前 Fiber 上所有 effect 的 cleanup 函数
  if (fiber.hooks) {
    fiber.hooks
      .filter((hook) => hook.tag === "effect" && typeof hook.cleanup === "function")
      .forEach((hook) => hook.cleanup());
  }

  // 递归遍历子树，清理所有子节点的 effect
  let child = fiber.child;
  while (child) {
    runCleanup(child);
    child = child.sibling;
  }
}
