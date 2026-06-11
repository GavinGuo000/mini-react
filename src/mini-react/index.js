/**
 * mini-react 对外入口文件
 *
 * 【职责】
 *   作为整个 mini-react 库的统一出口，汇聚所有模块的公共 API。
 *
 * 【两种导出方式】
 *   1. 默认导出 MiniReact 对象 —— 给 Vite 的 jsxFactory 配置使用
 *      （JSX 编译后会调用 MiniReact.createElement）
 *   2. 具名导出 —— 给应用代码按需导入使用
 *      （如 import { useState, createRoot } from './mini-react/index.js'）
 *
 * 【API 列表】
 *   - createElement: JSX 运行时入口，把 JSX 转成虚拟 DOM
 *   - Fragment:      <>...</> 片段的标识符
 *   - createRoot:    React 18 风格的渲染入口
 *   - render:        底层渲染函数（一般不直接使用）
 *   - useState:      状态管理
 *   - useReducer:    复杂状态管理
 *   - useEffect:     副作用
 *   - useRef:        跨渲染可变引用
 *   - useMemo:       计算缓存
 *   - useCallback:   回调缓存
 */

// 从 createElement 模块导入 JSX 运行时函数和 Fragment 标识符
import { createElement, Fragment } from "./createElement.js";
// 从协调器模块导入 render 函数（首次渲染入口）
import { render } from "./reconciler.js";
// 从 hooks 模块导入所有状态/副作用 hook
import {
  useState,
  useReducer,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "./hooks.js";

/**
 * createRoot —— 仿 React 18 的并发渲染入口 API。
 *
 * 【使用方式】
 *   const root = createRoot(document.getElementById('root'));
 *   root.render(<App />);
 *
 * 【与 React 的对比】
 *   React 18 废弃了 ReactDOM.render()，改用 createRoot API。
 *   createRoot 默认启用并发模式（Concurrent Mode），
 *   使渲染过程可中断，从而提高响应性。
 *
 * @param {HTMLElement} container - 真实 DOM 容器节点
 * @returns {{ render: function }} 包含 render 方法的对象
 */
function createRoot(container) {
  return {
    /**
     * 把虚拟 DOM 渲染到容器中。
     * 内部调用 reconciler.js 的 render 函数启动 Fiber 工作循环。
     */
    render(element) {
      render(element, container);
    },
  };
}

/**
 * MiniReact —— 默认导出对象。
 * Vite 的 jsxFactory 配置为 "MiniReact.createElement"，
 * 所以 JSX 编译后会调用这个对象上的 createElement 方法。
 */
const MiniReact = {
  createElement,  // JSX 运行时
  Fragment,       // 片段标识符
  createRoot,     // 渲染入口
  useState,       // 状态管理
  useReducer,     // 复杂状态
  useEffect,      // 副作用
  useRef,         // 可变引用
  useMemo,        // 计算缓存
  useCallback,    // 回调缓存
};

// 具名导出 —— 供应用代码按需导入
export {
  createElement,
  Fragment,
  createRoot,
  render,
  useState,
  useReducer,
  useEffect,
  useRef,
  useMemo,
  useCallback,
};

// 默认导出 —— 供 JSX 的 jsxFactory 使用
export default MiniReact;
