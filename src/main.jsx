/**
 * 应用入口文件 —— 启动 mini-react 应用。
 *
 * 【执行流程】
 *   1. 导入 createRoot 渲染函数和 App 根组件
 *   2. 导入全局样式
 *   3. 找到 DOM 中的 #root 容器
 *   4. 创建 root 并渲染 App 组件树
 *
 * 【与 React 的对比】
 *   用法与 React 18 的 createRoot API 完全一致：
 *     import { createRoot } from 'react-dom/client';
 *     const root = createRoot(document.getElementById('root'));
 *     root.render(<App />);
 */

// 导入 mini-react 的渲染入口
import { createRoot } from "/src/mini-react/index.js";
// 导入根组件（整个应用的组件树起点）
import App from "./App.jsx";
// 导入全局样式
import "./styles.css";

// 获取 DOM 中的根容器节点
const container = document.getElementById("root");
// 创建 root 对象，内部会初始化 Fiber 架构
const root = createRoot(container);
// 渲染 App 组件树，启动 Fiber 工作循环
root.render(<App />);
