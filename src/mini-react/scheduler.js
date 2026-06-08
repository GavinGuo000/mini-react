// ============================================================================
// 调度器 (Scheduler) —— React 并发模式的基石
// ----------------------------------------------------------------------------
// 目标：把一大段渲染工作切成很多小片，在浏览器每一帧的空闲时间里执行，
//      一旦时间用完就把控制权还给浏览器（让它去处理动画、输入等），
//      下一帧再继续。这样长列表渲染也不会卡住主线程。
//
// 真实 React 没有用 requestIdleCallback（兼容性 & 触发不稳定），而是用
// MessageChannel 自己实现了一个宏任务调度。这里我们也用 MessageChannel 模拟。
// ============================================================================

// 每一帧给我们自己的工作留出的时间预算（毫秒）。
// 浏览器一帧约 16.6ms，留一部分给渲染/合成，我们用 5ms 做切片单位。
const FRAME_BUDGET = 5;

let scheduledCallback = null;
let deadline = 0;

const channel = new MessageChannel();
const port = channel.port2;

channel.port1.onmessage = () => {
  if (!scheduledCallback) return;

  const callback = scheduledCallback;
  scheduledCallback = null;

  // 给本次执行设定一个「截止时间」，工作循环据此判断是否该让步。
  deadline = performance.now() + FRAME_BUDGET;
  callback();
};

// 类似 requestIdleCallback：注册一个回调，并提供「还剩多少时间」的查询能力。
export function scheduleWork(callback) {
  scheduledCallback = () => {
    callback({
      // 剩余时间 <= 0 表示本帧预算已用尽，应当让步给浏览器。
      timeRemaining: () => deadline - performance.now(),
    });
  };
  port.postMessage(null);
}
