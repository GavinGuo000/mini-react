/**
 * 调度器 (Scheduler) —— React 并发模式的基石
 *
 * 【目标】
 *   把一大段渲染工作切成很多小片，在浏览器每一帧的空闲时间里执行，
 *   一旦时间用完就把控制权还给浏览器（让它去处理动画、输入等），
 *   下一帧再继续。这样长列表渲染也不会卡住主线程。
 *
 * 【为什么不用 requestIdleCallback？】
 *   1. 兼容性差：Safari 至今不支持
 *   2. 触发不稳定：浏览器可能在某些场景下不触发回调
 *   因此真实 React 用 MessageChannel 自己实现了一个宏任务调度。
 *
 * 【MessageChannel 工作原理】
 *   MessageChannel 创建两个互相连接的端口（port1、port2）。
 *   当一端调用 postMessage() 时，另一端的 onmessage 事件会被触发。
 *   这本质上是一个「宏任务」（macrotask），类似于 setTimeout(fn, 0)，
 *   但比 setTimeout 更快，且不受 4ms 最小延迟限制。
 *
 * 【调度流程】
 *   1. 调用 scheduleWork(callback) 时，把 callback 存储到 scheduledCallback
 *   2. 通过 port2.postMessage(null) 触发一个宏任务
 *   3. 在宏任务执行时（port1.onmessage），计算截止时间并执行 callback
 *   4. callback 内部的工作循环不断检查 timeRemaining()，决定是继续工作还是让步
 */

/**
 * 每一帧中分配给我们工作循环的时间预算（毫秒）。
 *
 * 【为什么是 5ms？】
 *   浏览器一帧约 16.6ms（60fps = 1000/60），
 *   其中需要留出时间给浏览器的渲染、合成、输入处理等工作。
 *   5ms 是一个比较安全的切片单位，既能保证渲染工作有足够时间推进，
 *   又不会明显影响用户交互的响应速度。
 */
const FRAME_BUDGET = 5;

/** 当前被调度的回调函数（同一时间只允许一个回调等待执行） */
let scheduledCallback = null;

/** 本次回调执行的截止时间戳（由 performance.now() 计算得出） */
let deadline = 0;

/**
 * 创建 MessageChannel 实例，用于实现宏任务调度。
 *
 * 【port1】发送端 —— 监听 onmessage 事件，在收到消息时执行被调度的回调
 * 【port2】接收端 —— 通过 postMessage(null) 发送消息，触发 port1 的 onmessage
 *
 * 当 port2.postMessage(null) 被调用时，浏览器会在当前宏任务队列中安排一个任务，
 * 该任务执行时就会触发 port1.onmessage。
 */
const channel = new MessageChannel();
const port = channel.port2;

/**
 * port1 的消息处理器 —— 宏任务触发时执行。
 *
 * 【执行流程】
 *   1. 检查是否有等待执行的回调（scheduledCallback）
 *   2. 取出回调并清空 scheduledCallback（防止重复执行）
 *   3. 计算本次执行的截止时间（当前时间 + 时间预算）
 *   4. 执行回调，回调内部的工作循环会根据截止时间决定工作还是让步
 */
channel.port1.onmessage = () => {
  // 如果没有被调度的回调，直接返回（防御性检查）
  if (!scheduledCallback) return;

  // 取出当前回调并清空引用，确保同一回调不会被重复执行
  const callback = scheduledCallback;
  scheduledCallback = null;

  // 计算本次执行的截止时间戳。
  // 工作循环在每次迭代时会调用 timeRemaining()，
  // 当 deadline - performance.now() <= 0 时，表示时间用尽，应该让步给浏览器。
  deadline = performance.now() + FRAME_BUDGET;
  callback();
};

/**
 * 调度工作循环 —— 类似 requestIdleCallback 的简化版 API。
 *
 * 【工作流程】
 *   1. 把 callback 包装到 scheduledCallback 中
 *   2. 通过 port.postMessage(null) 触发一个宏任务
 *   3. 在宏任务执行时，调用 callback 并传入一个 deadline 对象
 *   4. callback 可以通过 deadline.timeRemaining() 查询剩余时间
 *
 * 【与 requestIdleCallback 的对比】
 *   requestIdleCallback(callback)
 *     -> callback(deadline) 其中 deadline.timeRemaining() 由浏览器提供
 *
 *   scheduleWork(callback)
 *     -> callback({ timeRemaining: () => deadline - performance.now() })
 *     我们自己计算剩余时间，实现更可控
 *
 * @param {function} callback - 工作循环函数，接收一个包含 timeRemaining 方法的对象
 */
export function scheduleWork(callback) {
  // 包装 callback，使其能访问剩余时间查询接口
  scheduledCallback = () => {
    callback({
      /**
       * 查询本帧剩余的可用时间。
       * @returns {number} 剩余毫秒数，<= 0 表示时间用尽，应当让步
       */
      timeRemaining: () => deadline - performance.now(),
    });
  };
  // 通过 MessageChannel 发送消息，触发宏任务执行
  // postMessage 会把消息放到宏任务队列，浏览器会在合适的时机执行
  port.postMessage(null);
}
